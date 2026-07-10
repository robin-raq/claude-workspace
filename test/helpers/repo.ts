import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExecaRunner, type CommandRunner, type RunResult } from '../../src/runner.js';

/**
 * Runner for integration tests: real executables, but Git is isolated from
 * the developer's global and system configuration and uses a fixed identity.
 */
export function makeTestRunner(extraEnv?: Record<string, string>): CommandRunner {
  return createExecaRunner({
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'cw-test',
    GIT_AUTHOR_EMAIL: 'cw-test@example.invalid',
    GIT_COMMITTER_NAME: 'cw-test',
    GIT_COMMITTER_EMAIL: 'cw-test@example.invalid',
    ...extraEnv,
  });
}

const tempDirs: string[] = [];

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

async function mustRun(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  const result = await runner(command, args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

/** Create a real temporary Git repository with one commit on main. */
export async function makeTempRepo(runner: CommandRunner): Promise<string> {
  const dir = await makeTempDir('cw-test-repo-');
  await mustRun(runner, 'git', ['init', '-q', '-b', 'main'], dir);
  await writeFile(path.join(dir, 'README.md'), '# test repo\n', 'utf8');
  await mustRun(runner, 'git', ['add', '.'], dir);
  await mustRun(runner, 'git', ['commit', '-q', '-m', 'initial commit'], dir);
  return dir;
}

export async function gitInDir(
  runner: CommandRunner,
  cwd: string,
  args: string[],
): Promise<RunResult> {
  return mustRun(runner, 'git', args, cwd);
}
