import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CwError } from '../../src/errors.js';
import * as git from '../../src/git.js';
import { loadManifest } from '../../src/manifest.js';
import {
  assertNoCollisions,
  createWorkspaceResources,
  planWorkspace,
  preflightRepo,
  rollbackCreated,
  type WorkspacePlan,
} from '../../src/workspace.js';
import {
  cleanupTempDirs,
  gitInDir,
  makeTempDir,
  makeTempRepo,
  makeTestRunner,
} from '../helpers/repo.js';

const runner = makeTestRunner();

afterEach(cleanupTempDirs);

async function setup(mode: 'focus' | 'parallel', name = 'demo') {
  const repoRoot = await makeTempRepo(runner);
  const worktreesRoot = await makeTempDir('cw-test-worktrees-');
  const workspacesDir = await makeTempDir('cw-test-state-');
  const preflight = await preflightRepo(runner, repoRoot, undefined);
  const plan = planWorkspace({
    mode,
    name,
    repoRoot: preflight.repoRoot,
    worktreesRoot,
    baseRef: preflight.baseRef,
    baseCommit: preflight.baseCommit,
    now: () => new Date(),
  });
  return { repoRoot, worktreesRoot, workspacesDir, plan };
}

async function create(
  plan: WorkspacePlan,
  workspacesDir: string,
  worktreesRoot: string,
): Promise<void> {
  await createWorkspaceResources(runner, {
    plan,
    workspacesDir,
    worktreesRoot,
    appVersion: '0.1.0',
    paneRoles: ['coordinator', 'builder', 'reviewer', 'verifier'],
  });
}

async function expectCwErrorAsync(
  fn: () => Promise<unknown>,
  category: string,
  messagePart?: string,
): Promise<CwError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CwError);
    const cwError = error as CwError;
    expect(cwError.category).toBe(category);
    if (messagePart !== undefined) expect(cwError.message).toContain(messagePart);
    return cwError;
  }
  throw new Error('expected the call to reject');
}

describe('workspace creation on a real repository', () => {
  it('creates a focus worktree, branch, and manifest', async () => {
    const { repoRoot, worktreesRoot, workspacesDir, plan } = await setup('focus');
    await create(plan, workspacesDir, worktreesRoot);

    const worktree = plan.worktrees[0];
    expect(worktree).toBeDefined();
    expect(existsSync(path.join(worktree!.path, 'README.md'))).toBe(true);
    expect(await git.branchExists(runner, repoRoot, 'cw/demo')).toBe(true);
    expect(await git.listWorktreePaths(runner, repoRoot)).toContain(worktree!.path);

    const loaded = await loadManifest(workspacesDir, 'demo');
    expect(loaded?.ok).toBe(true);
    if (loaded?.ok) {
      expect(loaded.manifest.branches).toEqual(['cw/demo']);
      expect(loaded.manifest.tmuxSession).toBe('cw-demo');
    }
  });

  it('creates four isolated worktrees for parallel mode', async () => {
    const { repoRoot, worktreesRoot, workspacesDir, plan } = await setup('parallel');
    await create(plan, workspacesDir, worktreesRoot);

    expect(plan.worktrees).toHaveLength(4);
    for (const worktree of plan.worktrees) {
      expect(existsSync(worktree.path)).toBe(true);
    }

    // A commit in track A must be invisible to track B: isolated index and tree.
    const [trackA, trackB] = plan.worktrees;
    await writeFile(path.join(trackA!.path, 'a-only.txt'), 'track a\n', 'utf8');
    await gitInDir(runner, trackA!.path, ['add', '.']);
    await gitInDir(runner, trackA!.path, ['commit', '-q', '-m', 'track a work']);
    expect(existsSync(path.join(trackB!.path, 'a-only.txt'))).toBe(false);
    expect(await git.isDirty(runner, trackB!.path)).toBe(false);
    expect(await git.branchExists(runner, repoRoot, 'cw/demo-a')).toBe(true);
  });
});

describe('preflight refusals', () => {
  it('refuses a dirty source checkout with an actionable message', async () => {
    const repoRoot = await makeTempRepo(runner);
    await writeFile(path.join(repoRoot, 'uncommitted.txt'), 'wip\n', 'utf8');
    const error = await expectCwErrorAsync(
      () => preflightRepo(runner, repoRoot, undefined),
      'GIT_ERROR',
      'uncommitted changes',
    );
    expect(error.hint).toContain('commit or stash');
  });

  it('refuses a directory that is not a Git repository', async () => {
    const dir = await makeTempDir('cw-test-notrepo-');
    await expectCwErrorAsync(() => preflightRepo(runner, dir, undefined), 'GIT_ERROR');
  });

  it('refuses a bare repository', async () => {
    // A bare repo has no toplevel, so repo-root resolution already refuses it;
    // preflightRepo's explicit isBareRepo check is a second line of defense.
    const dir = await makeTempDir('cw-test-nowt-');
    await gitInDir(runner, dir, ['init', '-q', '--bare']);
    await expectCwErrorAsync(() => preflightRepo(runner, dir, undefined), 'GIT_ERROR');
  });

  it('refuses an unresolvable base ref', async () => {
    const repoRoot = await makeTempRepo(runner);
    await expectCwErrorAsync(
      () => preflightRepo(runner, repoRoot, 'no-such-branch'),
      'GIT_ERROR',
      'no-such-branch',
    );
  });
});

describe('collision refusals', () => {
  it('refuses when the branch already exists', async () => {
    const { repoRoot, workspacesDir, plan } = await setup('focus');
    await gitInDir(runner, repoRoot, ['branch', 'cw/demo']);
    await expectCwErrorAsync(
      () => assertNoCollisions(runner, workspacesDir, plan),
      'WORKSPACE_CONFLICT',
      "branch 'cw/demo'",
    );
  });

  it('refuses when the worktree path already exists', async () => {
    const { workspacesDir, plan } = await setup('focus');
    const worktree = plan.worktrees[0]!;
    await mkdir(worktree.path, { recursive: true });
    await expectCwErrorAsync(
      () => assertNoCollisions(runner, workspacesDir, plan),
      'WORKSPACE_CONFLICT',
      'already exists',
    );
  });

  it('refuses when a manifest with the same name exists', async () => {
    const { worktreesRoot, workspacesDir, plan } = await setup('focus');
    await create(plan, workspacesDir, worktreesRoot);
    const error = await expectCwErrorAsync(
      () => assertNoCollisions(runner, workspacesDir, plan),
      'WORKSPACE_CONFLICT',
      "workspace 'demo' already exists",
    );
    expect(error.hint).toContain('cw attach');
  });
});

describe('rollback on partial failure', () => {
  it('removes worktrees and branches created by the failed invocation', async () => {
    const { repoRoot, worktreesRoot, workspacesDir, plan } = await setup('parallel');

    // Block the third worktree by pre-creating a plain file at its path.
    const blocked = plan.worktrees[2]!;
    await mkdir(path.dirname(blocked.path), { recursive: true });
    await writeFile(blocked.path, 'in the way\n', 'utf8');

    const error = await expectCwErrorAsync(
      () => create(plan, workspacesDir, worktreesRoot),
      'GIT_ERROR',
      'rollback',
    );
    expect(error.message).toContain('remove worktree');

    // Tracks a and b were created, then rolled back.
    expect(existsSync(plan.worktrees[0]!.path)).toBe(false);
    expect(existsSync(plan.worktrees[1]!.path)).toBe(false);
    expect(await git.branchExists(runner, repoRoot, 'cw/demo-a')).toBe(false);
    expect(await git.branchExists(runner, repoRoot, 'cw/demo-b')).toBe(false);
    expect(await loadManifest(workspacesDir, 'demo')).toBeNull();
    expect(await git.listWorktreePaths(runner, repoRoot)).toEqual([repoRoot]);
  });

  it('removes the manifest during rollback and reports steps that fail', async () => {
    const { repoRoot, worktreesRoot, workspacesDir, plan } = await setup('focus');
    await create(plan, workspacesDir, worktreesRoot);
    expect(await loadManifest(workspacesDir, 'demo')).not.toBeNull();

    // One real worktree (removable) plus one that was never created, so the
    // rollback report must show both a success and a failure.
    const ghost = { branch: 'cw/never-created', path: path.join(worktreesRoot, 'ghost') };
    const steps = await rollbackCreated(runner, repoRoot, workspacesDir, {
      worktrees: [plan.worktrees[0]!, ghost],
      manifestName: 'demo',
    });

    expect(await loadManifest(workspacesDir, 'demo')).toBeNull();
    expect(existsSync(plan.worktrees[0]!.path)).toBe(false);
    expect(await git.branchExists(runner, repoRoot, 'cw/demo')).toBe(false);

    const manifestStep = steps.find((step) => step.action === 'remove manifest');
    expect(manifestStep?.ok).toBe(true);
    const ghostSteps = steps.filter((step) => step.target.includes('ghost'));
    expect(ghostSteps.length).toBeGreaterThan(0);
    expect(ghostSteps.every((step) => !step.ok)).toBe(true);
    expect(ghostSteps[0]?.error).toBeTruthy();
  });
});

describe('branch and commit labels', () => {
  it('labels a detached HEAD with its short commit hash', async () => {
    const repoRoot = await makeTempRepo(runner);
    expect(await git.currentBranchOrCommit(runner, repoRoot)).toBe('main');
    await gitInDir(runner, repoRoot, ['checkout', '-q', '--detach']);
    expect(await git.currentBranchOrCommit(runner, repoRoot)).toMatch(/^detached@[0-9a-f]{4,}$/);
  });
});
