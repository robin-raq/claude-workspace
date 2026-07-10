import { afterEach, describe, expect, it } from 'vitest';
import {
  bannerShellCommand,
  createWorkspaceSession,
  hasSession,
  killSession,
  listPaneLabels,
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

function spec(session: string, cwd: string): SessionSpec {
  const pane = (title: string, color: SessionSpec['panes'][0]['color']) => ({
    title,
    color,
    cwd,
    command: bannerShellCommand(`${title} ready`),
  });
  return {
    session,
    colorEnabled: true,
    panes: [
      pane('COORDINATOR · main', 'cyan'),
      pane('BUILDER · cw/demo', 'green'),
      pane('REVIEWER · cw/demo', 'magenta'),
      pane('VERIFIER · cw/demo', 'yellow'),
    ],
  };
}

describe('createWorkspaceSession on an isolated tmux server', () => {
  it('creates a four-pane titled session and cleans up on kill', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);

    await createWorkspaceSession(tmux, spec('cw-demo', process.cwd()));

    expect(await hasSession(tmux, 'cw-demo')).toBe(true);
    const titles = await listPaneTitles(tmux, 'cw-demo');
    expect(titles).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/demo',
      'REVIEWER · cw/demo',
      'VERIFIER · cw/demo',
    ]);

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
    expect(border.stdout).toContain('#{@cw_title}');

    // Every pane carries the cw-owned label option the border renders.
    expect(await listPaneLabels(tmux, 'cw-demo')).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/demo',
      'REVIEWER · cw/demo',
      'VERIFIER · cw/demo',
    ]);

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
      createWorkspaceSession(failing, spec('cw-broken', process.cwd())),
    ).rejects.toMatchObject({
      category: 'LAUNCH_ERROR',
    });
    expect(await hasSession(tmux, 'cw-broken')).toBe(false);
  });
});

/** Poll until the condition holds; integration timing must not flake. */
async function eventually(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition not reached within timeout');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

describe('role labels survive processes that rewrite the terminal title', () => {
  // Claude Code updates its terminal title (an OSC 2 escape) while it works;
  // this pane command does the same thing aggressively.
  const hijacker = `while :; do printf '\\033]2;HIJACKED\\007'; sleep 0.1; done`;

  function hijackSpec(session: string, colorEnabled: boolean): SessionSpec {
    const pane = (title: string, color: SessionSpec['panes'][0]['color']) => ({
      title,
      color,
      cwd: process.cwd(),
      command: hijacker,
    });
    return {
      session,
      colorEnabled,
      panes: [
        pane('COORDINATOR · main', 'cyan'),
        pane('BUILDER · cw/demo', 'green'),
        pane('REVIEWER · cw/demo', 'magenta'),
        pane('VERIFIER · cw/demo', 'yellow'),
      ],
    };
  }

  it('keeps all four labels in the border after every pane title is hijacked', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);
    await createWorkspaceSession(tmux, hijackSpec('cw-hijack', true));

    // First prove the hijack really happened: pane_title is process-writable.
    await eventually(async () =>
      (await listPaneTitles(tmux, 'cw-hijack')).every((title) => title === 'HIJACKED'),
    );

    // The cw-owned labels are untouched...
    expect(await listPaneLabels(tmux, 'cw-hijack')).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/demo',
      'REVIEWER · cw/demo',
      'VERIFIER · cw/demo',
    ]);

    // ...and the border tmux actually renders still shows each role. Pane 0
    // is active (createWorkspaceSession selects it), the rest are inactive,
    // so this covers both style branches of the format.
    const paneIds = (
      await tmux(['list-panes', '-t', 'cw-hijack:workspace', '-F', '#{pane_id}'])
    ).stdout
      .trim()
      .split('\n');
    const labels = ['COORDINATOR', 'BUILDER', 'REVIEWER', 'VERIFIER'];
    for (const [index, paneId] of paneIds.entries()) {
      const border = await renderedBorder(tmux, 'cw-hijack', paneId);
      expect(border).toContain(`${labels[index]} · `);
      expect(border).not.toContain('HIJACKED');
    }
  });

  it('keeps the labels without color as well (--no-color / NO_COLOR)', async () => {
    const { tmux, killServer } = makeIsolatedTmux(runner);
    cleanups.push(killServer);
    await createWorkspaceSession(tmux, hijackSpec('cw-hijack-plain', false));

    await eventually(async () =>
      (await listPaneTitles(tmux, 'cw-hijack-plain')).every((title) => title === 'HIJACKED'),
    );

    const paneIds = (
      await tmux(['list-panes', '-t', 'cw-hijack-plain:workspace', '-F', '#{pane_id}'])
    ).stdout
      .trim()
      .split('\n');
    for (const [index, paneId] of paneIds.entries()) {
      const border = await renderedBorder(tmux, 'cw-hijack-plain', paneId);
      expect(border).toContain(['COORDINATOR', 'BUILDER', 'REVIEWER', 'VERIFIER'][index] ?? '');
      expect(border).not.toContain('fg=');
    }
  });
});
