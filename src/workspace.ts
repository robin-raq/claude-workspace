import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CwError, type ErrorCategory } from './errors.js';
import * as git from './git.js';
import {
  deleteManifest,
  manifestExists,
  saveManifest,
  MANIFEST_SCHEMA_VERSION,
  type WorkspaceManifest,
} from './manifest.js';
import type { CommandRunner } from './runner.js';

export type Mode = 'focus' | 'parallel' | 'team';

export const TMUX_SESSION_PREFIX = 'cw-';
export const BRANCH_NAMESPACE = 'cw/';
const PARALLEL_TRACKS = ['a', 'b', 'c', 'd'] as const;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validateWorkspaceName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new CwError('USAGE_ERROR', `invalid workspace name '${name}'`, {
      hint: 'use 1-40 lowercase letters, digits, or hyphens, starting with a letter or digit',
    });
  }
}

/** Stable, human-recognizable per-repository directory key. */
export function repoKey(repoRoot: string): string {
  const hash = createHash('sha256').update(path.resolve(repoRoot)).digest('hex').slice(0, 8);
  return `${path.basename(repoRoot)}-${hash}`;
}

export function sessionNameFor(name: string): string {
  return `${TMUX_SESSION_PREFIX}${name}`;
}

/**
 * Assert that candidate resolves to a location strictly beneath root.
 * The error category depends on the caller: creation raises USAGE_ERROR,
 * cleanup raises UNSAFE_CLEANUP.
 */
export function assertContained(
  root: string,
  candidate: string,
  category: ErrorCategory = 'USAGE_ERROR',
): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CwError(
      category,
      `path '${candidate}' is not contained in the application worktree root '${root}'`,
      { hint: 'this indicates an unsafe workspace path; nothing was modified' },
    );
  }
}

export interface PlannedWorktree {
  branch: string;
  path: string;
}

/**
 * Everything workspace creation will do, computed up front so that --dry-run
 * can render it and tests can assert on it without touching the system.
 */
export interface WorkspacePlan {
  id: string;
  name: string;
  mode: Mode;
  repoRoot: string;
  baseRef: string;
  baseCommit: string;
  sessionName: string;
  worktrees: PlannedWorktree[];
  createdAt: string;
}

export interface PlanInputs {
  mode: Mode;
  name: string;
  repoRoot: string;
  worktreesRoot: string;
  baseRef: string;
  baseCommit: string;
  now: () => Date;
  randomId?: () => string;
}

export function planWorkspace(inputs: PlanInputs): WorkspacePlan {
  validateWorkspaceName(inputs.name);
  const random = inputs.randomId ?? (() => randomBytes(3).toString('hex'));
  const repoDir = path.join(inputs.worktreesRoot, repoKey(inputs.repoRoot));

  let worktrees: PlannedWorktree[];
  switch (inputs.mode) {
    case 'focus':
      worktrees = [
        { branch: `${BRANCH_NAMESPACE}${inputs.name}`, path: path.join(repoDir, inputs.name) },
      ];
      break;
    case 'parallel':
      worktrees = PARALLEL_TRACKS.map((track) => ({
        branch: `${BRANCH_NAMESPACE}${inputs.name}-${track}`,
        path: path.join(repoDir, `${inputs.name}-${track}`),
      }));
      break;
    case 'team':
      worktrees = [];
      break;
  }

  for (const worktree of worktrees) {
    assertContained(inputs.worktreesRoot, worktree.path);
  }

  return {
    id: `${inputs.name}-${random()}`,
    name: inputs.name,
    mode: inputs.mode,
    repoRoot: inputs.repoRoot,
    baseRef: inputs.baseRef,
    baseCommit: inputs.baseCommit,
    sessionName: sessionNameFor(inputs.name),
    worktrees,
    createdAt: inputs.now().toISOString(),
  };
}

export interface RepoPreflight {
  repoRoot: string;
  baseRef: string;
  baseCommit: string;
}

/**
 * Validate the source repository before planning: inside a repo, not bare,
 * clean checkout, resolvable base ref.
 */
export async function preflightRepo(
  runner: CommandRunner,
  cwd: string,
  baseRef: string | undefined,
): Promise<RepoPreflight> {
  const repoRoot = await git.resolveRepoRoot(runner, cwd);
  if (await git.isBareRepo(runner, repoRoot)) {
    throw new CwError('GIT_ERROR', `repository '${repoRoot}' is bare`, {
      hint: 'cw needs a repository with a working tree',
    });
  }
  if (await git.isDirty(runner, repoRoot)) {
    throw new CwError(
      'GIT_ERROR',
      `the checkout at '${repoRoot}' has uncommitted changes; new worktrees start from a commit and would not include them`,
      { hint: 'commit or stash your changes, then rerun the command' },
    );
  }
  const ref = baseRef ?? 'HEAD';
  const baseCommit = await git.resolveCommit(runner, repoRoot, ref);
  return { repoRoot, baseRef: ref, baseCommit };
}

/** Refuse creation when any resource the plan would create already exists. */
export async function assertNoCollisions(
  runner: CommandRunner,
  workspacesDir: string,
  plan: WorkspacePlan,
): Promise<void> {
  if (await manifestExists(workspacesDir, plan.name)) {
    throw new CwError('WORKSPACE_CONFLICT', `workspace '${plan.name}' already exists`, {
      hint: `attach with 'cw attach ${plan.name}' or remove it with 'cw clean ${plan.name}'`,
    });
  }
  const registered = new Set(await git.listWorktreePaths(runner, plan.repoRoot));
  for (const worktree of plan.worktrees) {
    if (await git.branchExists(runner, plan.repoRoot, worktree.branch)) {
      throw new CwError(
        'WORKSPACE_CONFLICT',
        `branch '${worktree.branch}' already exists in ${plan.repoRoot}`,
        { hint: 'choose a different workspace name, or delete the branch manually if it is stale' },
      );
    }
    if (registered.has(worktree.path) || existsSync(worktree.path)) {
      throw new CwError('WORKSPACE_CONFLICT', `worktree path '${worktree.path}' already exists`, {
        hint: 'choose a different workspace name, or remove the stale directory manually',
      });
    }
  }
}

export interface RollbackStep {
  action: string;
  target: string;
  ok: boolean;
  error?: string;
}

interface CreatedResources {
  worktrees: PlannedWorktree[];
  manifestName: string | null;
}

/**
 * Create the plan's worktrees (and branches) and write the manifest.
 * On failure, everything created by this invocation is rolled back in
 * reverse order and the raised error reports how the rollback went.
 */
export async function createWorkspaceResources(
  runner: CommandRunner,
  options: {
    plan: WorkspacePlan;
    workspacesDir: string;
    worktreesRoot: string;
    appVersion: string;
    paneRoles: [string, string, string, string];
  },
): Promise<WorkspaceManifest> {
  const { plan } = options;
  const created: CreatedResources = { worktrees: [], manifestName: null };

  try {
    if (plan.worktrees.length > 0) {
      await mkdir(path.join(options.worktreesRoot, repoKey(plan.repoRoot)), { recursive: true });
    }
    for (const worktree of plan.worktrees) {
      assertContained(options.worktreesRoot, worktree.path);
      await git.addWorktree(runner, plan.repoRoot, {
        path: worktree.path,
        branch: worktree.branch,
        startPoint: plan.baseCommit,
      });
      created.worktrees.push(worktree);
    }

    const manifest: WorkspaceManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      appVersion: options.appVersion,
      id: plan.id,
      name: plan.name,
      mode: plan.mode,
      repoRoot: plan.repoRoot,
      tmuxSession: plan.sessionName,
      baseRef: plan.baseRef,
      worktreePaths: plan.worktrees.map((worktree) => worktree.path),
      branches: plan.worktrees.map((worktree) => worktree.branch),
      paneRoles: options.paneRoles,
      createdAt: plan.createdAt,
    };
    await saveManifest(options.workspacesDir, manifest);
    created.manifestName = plan.name;
    return manifest;
  } catch (error) {
    const steps = await rollbackCreated(runner, plan.repoRoot, options.workspacesDir, created);
    throw withRollbackReport(error, steps);
  }
}

/**
 * Remove resources created by the current invocation, in reverse order.
 * Used both for creation failures and for failures after creation (e.g. the
 * tmux session could not be started).
 */
export async function rollbackCreated(
  runner: CommandRunner,
  repoRoot: string,
  workspacesDir: string,
  created: { worktrees: PlannedWorktree[]; manifestName: string | null },
): Promise<RollbackStep[]> {
  const steps: RollbackStep[] = [];

  if (created.manifestName !== null) {
    steps.push(
      await attempt('remove manifest', created.manifestName, () =>
        deleteManifest(workspacesDir, created.manifestName as string),
      ),
    );
  }
  for (const worktree of [...created.worktrees].reverse()) {
    steps.push(
      await attempt('remove worktree', worktree.path, () =>
        git.removeWorktree(runner, repoRoot, worktree.path),
      ),
    );
    steps.push(
      await attempt('delete branch (created this run)', worktree.branch, () =>
        git.deleteBranchForRollback(runner, repoRoot, worktree.branch),
      ),
    );
  }
  return steps;
}

export function withRollbackReport(error: unknown, steps: RollbackStep[]): CwError {
  const summary =
    steps.length === 0
      ? 'nothing had been created yet'
      : steps
          .map(
            (step) =>
              `${step.ok ? 'ok' : 'FAILED'}: ${step.action} ${step.target}${step.error === undefined ? '' : ` (${step.error})`}`,
          )
          .join('\n  ');
  const base =
    error instanceof CwError
      ? error
      : new CwError('LAUNCH_ERROR', error instanceof Error ? error.message : String(error), {
          cause: error,
        });
  return new CwError(base.category, `${base.message}\nrollback:\n  ${summary}`, {
    hint: base.hint,
    cause: base.cause,
  });
}

async function attempt(
  action: string,
  target: string,
  operation: () => Promise<void>,
): Promise<RollbackStep> {
  try {
    await operation();
    return { action, target, ok: true };
  } catch (error) {
    return {
      action,
      target,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
