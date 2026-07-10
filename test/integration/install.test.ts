import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExecaRunner, type CommandRunner } from '../../src/runner.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/repo.js';

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Installer tests run entirely inside a temporary HOME. The real HOME, real
 * ~/.local, and the developer's installation are never touched. Builds are
 * skipped (CW_INSTALL_SKIP_BUILD=1) so the repo's node_modules is not
 * clobbered mid-test-run; the suite builds dist itself if it is missing.
 */
let home: string;
let runner: CommandRunner;

function installerEnv(): Record<string, string> {
  return {
    HOME: home,
    XDG_DATA_HOME: '',
    XDG_STATE_HOME: '',
    CW_INSTALL_SKIP_BUILD: '1',
  };
}

async function sh(script: string, args: string[]): Promise<{ exitCode: number; out: string }> {
  const result = await runner('bash', [path.join(REPO_DIR, 'scripts', script), ...args], {
    cwd: REPO_DIR,
    env: installerEnv(),
  });
  return { exitCode: result.exitCode, out: `${result.stdout}\n${result.stderr}` };
}

const wrapper = (): string => path.join(home, '.local', 'bin', 'cw');
const appDir = (): string => path.join(home, '.local', 'share', 'claude-workspace', 'app');
const record = (): string =>
  path.join(home, '.local', 'share', 'claude-workspace', 'install-record.txt');

beforeAll(async () => {
  runner = createExecaRunner();
  home = await makeTempDir('cw-test-home-');
  if (!existsSync(path.join(REPO_DIR, 'dist', 'index.js'))) {
    const build = await runner('npm', ['run', 'build'], { cwd: REPO_DIR });
    expect(build.exitCode).toBe(0);
  }
}, 120_000);

afterAll(cleanupTempDirs);

describe('install.sh / uninstall.sh in a temporary HOME', () => {
  it('previews with --dry-run and changes nothing', async () => {
    const result = await sh('install.sh', ['--dry-run']);
    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('[dry-run]');
    expect(existsSync(wrapper())).toBe(false);
    expect(existsSync(appDir())).toBe(false);
  });

  it('installs a self-contained runtime and a working wrapper', async () => {
    const result = await sh('install.sh', []);
    expect(result.exitCode, result.out).toBe(0);

    expect(existsSync(wrapper())).toBe(true);
    expect(existsSync(path.join(appDir(), 'dist', 'index.js'))).toBe(true);
    expect(existsSync(path.join(appDir(), 'prompts', 'builder.md'))).toBe(true);
    expect(existsSync(path.join(appDir(), 'node_modules', 'commander'))).toBe(true);
    expect(existsSync(record())).toBe(true);

    // Self-contained: the wrapper points at the installed runtime, not the clone.
    const wrapperContent = await readFile(wrapper(), 'utf8');
    expect(wrapperContent).toContain(appDir());
    expect(wrapperContent).not.toContain(`${REPO_DIR}/dist`);

    const version = await runner(wrapper(), ['version'], { env: { HOME: home } });
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toContain('cw 0.1.0');
    expect(version.stdout).toContain('unofficial');
  }, 180_000);

  it('is idempotent: reinstalling over itself succeeds', async () => {
    const result = await sh('install.sh', []);
    expect(result.exitCode, result.out).toBe(0);
    const version = await runner(wrapper(), ['version'], { env: { HOME: home } });
    expect(version.exitCode).toBe(0);
  }, 180_000);

  it('uninstall --dry-run changes nothing', async () => {
    const result = await sh('uninstall.sh', ['--dry-run']);
    expect(result.exitCode).toBe(0);
    expect(existsSync(wrapper())).toBe(true);
    expect(existsSync(appDir())).toBe(true);
    expect(existsSync(record())).toBe(true);
  });

  it('uninstalls only what it owns and preserves workspace state', async () => {
    const stateDir = path.join(home, '.local', 'state', 'claude-workspace', 'workspaces');
    await mkdir(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, 'keep-me.json');
    await writeFile(stateFile, '{}\n', 'utf8');

    const result = await sh('uninstall.sh', []);
    expect(result.exitCode, result.out).toBe(0);
    expect(existsSync(wrapper())).toBe(false);
    expect(existsSync(appDir())).toBe(false);
    expect(existsSync(record())).toBe(false);
    // Workspace state and (hypothetical) worktrees survive.
    expect(existsSync(stateFile)).toBe(true);
    expect(result.out).toContain('preserved');
  });

  it('refuses to overwrite an unrelated cw binary', async () => {
    const binDir = path.join(home, '.local', 'bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, 'cw'), '#!/bin/sh\necho unrelated\n', 'utf8');

    const result = await sh('install.sh', []);
    expect(result.exitCode).not.toBe(0);
    expect(result.out).toContain('refusing to overwrite');
    expect(await readFile(path.join(binDir, 'cw'), 'utf8')).toContain('unrelated');
  }, 180_000);
});
