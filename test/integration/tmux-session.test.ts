import { afterEach, describe, expect, it } from 'vitest';
import {
  bannerShellCommand,
  createWorkspaceSession,
  hasSession,
  killSession,
  listPaneRoles,
  listPaneTitles,
  type SessionSpec,
  type TmuxExec,
} from '../../src/tmux.js';
import { makeTestRunner } from '../helpers/repo.js';
import { makeIsolatedTmux } from '../helpers/tmux.js';

const runner = makeTestRunner();

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

const ROLES = ['COORDINATOR', 'BUILDER', 'REVIEWER', 'VERIFIER'] as const;
const COLORS = ['cyan', 'green', 'magenta', 'yellow'] as const;

function spec(
  session: string,
  cwd: string,
  commandFor: (role: string) => string,
  colorEnabled = true,
): SessionSpec {
  const panes = ROLES.map((role, index) => ({
    role,
    context: index === 0 ? 'main' : 'cw/demo',
    color: COLORS[index]!,
    cwd,
    command: commandFor(role),
  }));
  return {
    session,
    colorEnabled,
    panes: panes as unknown as SessionSpec['panes'],
  };
}

/** Poll until the condition holds; integration timing must not flake. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition not reached within timeout');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function paneIds(tmux: TmuxExec, session: string): Promise<string[]> {
  const result = await tmux(['list-panes', '-t', `${session}:workspace`, '-F', '#{pane_id}']);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim().split('\n');
}

/** The border text tmux would draw for a pane: the configured format, expanded in that pane's context. */
async function renderedBorder(tmux: TmuxExec, session: string, paneId: string): Promise<string> {
  const format = await tmux([
    'show-options',
    '-w',
    '-t',
    `${session}:workspace`,
    '-v',
    'pane-border-format',
  ]);
  expect(format.exitCode).toBe(0);
  const rendered = await tmux(['display-message', '-p', '-t', paneId, format.stdout.trim()]);
  expect(rendered.exitCode).toBe(0);
  return rendered.stdout;
}

describe('createWorkspaceSession on an isolated tmux server', () => {
  it('creates a four-pane titled session and cleans up on kill', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);

    await createWorkspaceSession(
      tmux,
      spec('cw-demo', process.cwd(), (role) => bannerShellCommand(`${role} ready`)),
    );

    expect(await hasSession(tmux, 'cw-demo')).toBe(true);
    expect(await listPaneTitles(tmux, 'cw-demo')).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/demo',
      'REVIEWER · cw/demo',
      'VERIFIER · cw/demo',
    ]);
    // Role identity lives in the cw-owned pane option, not the title.
    expect(await listPaneRoles(tmux, 'cw-demo')).toEqual([...ROLES]);

    // Session options are session/window scoped, not global.
    const mouse = await tmux(['show-options', '-t', 'cw-demo', 'mouse']);
    expect(mouse.stdout.trim()).toBe('mouse on');
    const border = await tmux([
      'show-options',
      '-w',
      '-t',
      'cw-demo:workspace',
      'pane-border-format',
    ]);
    expect(border.stdout).toContain('fg=cyan');
    expect(border.stdout).toContain('#{@cw_role}');

    await killSession(tmux, 'cw-demo');
    expect(await hasSession(tmux, 'cw-demo')).toBe(false);
  });

  it('kills the half-built session when a tmux step fails mid-creation', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);

    // Force a deterministic failure partway through: the splits succeed
    // against the real server, then select-layout reports a failure.
    const failing: typeof tmux = async (args) => {
      if (args.includes('select-layout')) {
        return { command: 'tmux', args, stdout: '', stderr: 'injected failure', exitCode: 1 };
      }
      return tmux(args);
    };

    await expect(
      createWorkspaceSession(
        failing,
        spec('cw-broken', process.cwd(), (role) => bannerShellCommand(`${role} ready`)),
      ),
    ).rejects.toMatchObject({
      category: 'LAUNCH_ERROR',
    });
    expect(await hasSession(tmux, 'cw-broken')).toBe(false);
  });
});

describe('role labels survive processes that rewrite the terminal title', () => {
  // Claude Code updates its terminal title (an OSC 2 escape) while it works;
  // this pane command does the same thing aggressively.
  const hijacker = `while :; do printf '\\033]2;HIJACKED\\007'; sleep 0.1; done`;

  it('keeps every @cw_role and the rendered border intact after every pane title is hijacked', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);
    await createWorkspaceSession(
      tmux,
      spec('cw-hijack', process.cwd(), () => hijacker),
    );

    // First prove the hijack really happened: pane_title is process-writable.
    await eventually(async () =>
      (await listPaneTitles(tmux, 'cw-hijack')).every((title) => title === 'HIJACKED'),
    );

    // The cw-owned role options are untouched — checked per pane, exactly
    // the way an operator would (show-options -p -t <pane> @cw_role).
    const ids = await paneIds(tmux, 'cw-hijack');
    for (const [index, paneId] of ids.entries()) {
      const role = await tmux(['show-options', '-p', '-t', paneId, '-v', '@cw_role']);
      expect(role.stdout.trim()).toBe(ROLES[index]);
    }
    expect(await listPaneRoles(tmux, 'cw-hijack')).toEqual([...ROLES]);

    // ...and the border tmux actually renders still shows each role. Pane 0
    // is active (createWorkspaceSession selects it), the rest are inactive,
    // so this covers both style branches of the format.
    for (const [index, paneId] of ids.entries()) {
      const border = await renderedBorder(tmux, 'cw-hijack', paneId);
      expect(border).toContain(`${ROLES[index]} · `);
      expect(border).not.toContain('HIJACKED');
    }
  });

  it('keeps the labels without color as well (--no-color / NO_COLOR)', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);
    await createWorkspaceSession(
      tmux,
      spec('cw-hijack-plain', process.cwd(), () => hijacker, false),
    );

    await eventually(async () =>
      (await listPaneTitles(tmux, 'cw-hijack-plain')).every((title) => title === 'HIJACKED'),
    );

    const ids = await paneIds(tmux, 'cw-hijack-plain');
    for (const [index, paneId] of ids.entries()) {
      const border = await renderedBorder(tmux, 'cw-hijack-plain', paneId);
      expect(border).toContain(ROLES[index]!);
      expect(border).not.toContain('fg=');
    }
  });
});
