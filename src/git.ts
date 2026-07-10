import { CwError } from './errors.js';
import type { CommandRunner } from './runner.js';

/**
 * Read and worktree-lifecycle Git operations only. This module deliberately
 * exposes no push, merge, reset, tag, or remote mutation of any kind.
 */

async function git(runner: CommandRunner, cwd: string, args: string[]): Promise<string> {
  const result = await runner('git', args, { cwd });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.exitCode}`;
    throw new CwError('GIT_ERROR', `git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

export async function resolveRepoRoot(runner: CommandRunner, cwd: string): Promise<string> {
  const result = await runner('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (result.exitCode !== 0) {
    throw new CwError('GIT_ERROR', `'${cwd}' is not inside a Git repository`, {
      hint: 'run cw from inside the repository you want a workspace for',
    });
  }
  return result.stdout.trim();
}

export async function isBareRepo(runner: CommandRunner, cwd: string): Promise<boolean> {
  const out = await git(runner, cwd, ['rev-parse', '--is-bare-repository']);
  return out.trim() === 'true';
}

/** True when the checkout has staged, unstaged, or untracked changes. */
export async function isDirty(runner: CommandRunner, dir: string): Promise<boolean> {
  const out = await git(runner, dir, ['status', '--porcelain']);
  return out.trim() !== '';
}

/** Resolve a ref to a commit hash; fails with an actionable GIT_ERROR. */
export async function resolveCommit(
  runner: CommandRunner,
  repoRoot: string,
  ref: string,
): Promise<string> {
  const result = await runner('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    throw new CwError('GIT_ERROR', `base ref '${ref}' does not resolve to a commit`, {
      hint: 'pass an existing branch, tag, or commit via --base',
    });
  }
  return result.stdout.trim();
}

export async function branchExists(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const result = await runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoRoot,
  });
  return result.exitCode === 0;
}

/** Absolute paths of every worktree registered on the repository. */
export async function listWorktreePaths(
  runner: CommandRunner,
  repoRoot: string,
): Promise<string[]> {
  const out = await git(runner, repoRoot, ['worktree', 'list', '--porcelain']);
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

/** Create a worktree together with a new branch at the given start point. */
export async function addWorktree(
  runner: CommandRunner,
  repoRoot: string,
  options: { path: string; branch: string; startPoint: string },
): Promise<void> {
  await git(runner, repoRoot, [
    'worktree',
    'add',
    '-b',
    options.branch,
    options.path,
    options.startPoint,
  ]);
}

/** Remove a clean worktree. Never uses --force. */
export async function removeWorktree(
  runner: CommandRunner,
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  await git(runner, repoRoot, ['worktree', 'remove', worktreePath]);
}

/**
 * Force-delete a branch. Only valid for branches created by the same failed
 * invocation during rollback; user-facing cleanup always preserves branches.
 */
export async function deleteBranchForRollback(
  runner: CommandRunner,
  repoRoot: string,
  branch: string,
): Promise<void> {
  await git(runner, repoRoot, ['branch', '-D', branch]);
}

/** Short branch name, or 'detached@<short-hash>' on a detached HEAD. */
export async function currentBranchOrCommit(runner: CommandRunner, dir: string): Promise<string> {
  const branch = await runner('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: dir });
  if (branch.exitCode === 0) return branch.stdout.trim();
  const commit = await git(runner, dir, ['rev-parse', '--short', 'HEAD']);
  return `detached@${commit.trim()}`;
}

/** Current git version string, or null when git is unavailable. */
export async function gitVersion(runner: CommandRunner): Promise<string | null> {
  const result = await runner('git', ['--version']);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}
