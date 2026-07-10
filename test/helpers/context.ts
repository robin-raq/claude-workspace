import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../src/cli.js';
import type { AppContext } from '../../src/context.js';
import { resolveAppPaths } from '../../src/platform.js';
import type { CommandRunner } from '../../src/runner.js';
import { makeTempDir, makeTestRunner } from './repo.js';

export const FIXTURE_BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'bin',
);

export interface TestContext {
  ctx: AppContext;
  lines: string[];
  errors: string[];
  runner: CommandRunner;
  socketName: string;
}

/**
 * A fully isolated AppContext: temp XDG dirs, captured output, an isolated
 * tmux socket, and (optionally) the fake `claude` fixture first on PATH.
 */
export async function makeTestContext(options: {
  cwd: string;
  fakeClaude?: boolean;
  env?: Record<string, string>;
}): Promise<TestContext> {
  const stateHome = await makeTempDir('cw-test-xdg-state-');
  const dataHome = await makeTempDir('cw-test-xdg-data-');
  const socketName = `cw-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  const pathValue =
    options.fakeClaude === true
      ? `${FIXTURE_BIN}:${process.env['PATH'] ?? ''}`
      : (process.env['PATH'] ?? '');
  const env: Record<string, string | undefined> = {
    PATH: pathValue,
    XDG_STATE_HOME: stateHome,
    XDG_DATA_HOME: dataHome,
    ...options.env,
  };
  const runner = makeTestRunner({ PATH: pathValue });

  const lines: string[] = [];
  const errors: string[] = [];
  const ctx: AppContext = {
    stdout: (text) => lines.push(text),
    stderr: (text) => errors.push(text),
    runner,
    env,
    cwd: options.cwd,
    appVersion: APP_VERSION,
    promptsDir: path.resolve(FIXTURE_BIN, '..', '..', '..', 'prompts'),
    paths: resolveAppPaths(env, '/nonexistent-home'),
    platform: { kind: 'wsl', supported: true, detail: 'WSL 2 (test)' },
    tmuxSocketName: socketName,
    isTTY: false,
  };
  return { ctx, lines, errors, runner, socketName };
}
