import { afterEach, describe, expect, it } from 'vitest';
import {
  bannerShellCommand,
  createWorkspaceSession,
  hasSession,
  killSession,
  listPaneTitles,
  type SessionSpec,
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
    expect(border.stdout).toContain('#T');

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
