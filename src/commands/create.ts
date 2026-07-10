import { claudeLaunchArgv, claudeVersion, readRolePrompt } from '../claude.js';
import type { AppContext } from '../context.js';
import { CwError } from '../errors.js';
import * as git from '../git.js';
import { makeColorizer, shouldUseColor } from '../output.js';
import { isWindowsMountPath } from '../platform.js';
import { rolesForMode, type RoleSpec } from '../roles.js';
import {
  attachSessionInteractive,
  bannerShellCommand,
  createWorkspaceSession,
  failureVisibleCommand,
  hasSession,
  makeTmux,
  paneTitle,
  shellCommand,
  shellQuote,
  tmuxVersion,
  type PaneSpec,
} from '../tmux.js';
import {
  assertNoCollisions,
  createWorkspaceResources,
  planWorkspace,
  preflightRepo,
  rollbackCreated,
  validateWorkspaceName,
  withRollbackReport,
  type Mode,
  type WorkspacePlan,
} from '../workspace.js';

export interface CreateModeOptions {
  mode: Mode;
  name: string;
  base?: string;
  /** Team mode's task, passed to the Team Lead as its initial prompt. */
  task?: string;
  dryRun: boolean;
  /** false when --no-claude was given. */
  claude: boolean;
  /** false when --no-color was given. */
  color: boolean;
}

type FourPanes = readonly [PaneSpec, PaneSpec, PaneSpec, PaneSpec];

export async function runCreate(ctx: AppContext, options: CreateModeOptions): Promise<void> {
  if (!ctx.platform.supported) {
    throw new CwError('DEPENDENCY_ERROR', `unsupported platform: ${ctx.platform.detail}`, {
      hint: 'cw v0.1.0 supports WSL 2 and modern Linux distributions',
    });
  }
  validateWorkspaceName(options.name);
  const colorEnabled = shouldUseColor(ctx.env, !options.color);

  const preflight = await preflightRepo(ctx.runner, ctx.cwd, options.base);
  if (isWindowsMountPath(preflight.repoRoot)) {
    ctx.stderr(
      `warning: this repository lives on a Windows-mounted filesystem (${preflight.repoRoot}). ` +
        'Git and file operations are much slower there; a path under your WSL home directory ' +
        '(e.g. ~/projects) is strongly recommended.',
    );
  }

  const plan = planWorkspace({
    mode: options.mode,
    name: options.name,
    repoRoot: preflight.repoRoot,
    worktreesRoot: ctx.paths.worktreesRoot,
    baseRef: preflight.baseRef,
    baseCommit: preflight.baseCommit,
    now: () => new Date(),
  });
  const roles = rolesForMode(options.mode);
  const panes = await buildPaneSpecs(ctx, plan, roles, options);

  // Read-only collision checks run for dry runs too, so the preview is honest.
  await assertNoCollisions(ctx.runner, ctx.paths.workspacesDir, plan);

  if (options.dryRun) {
    renderDryRun(ctx, plan, roles, panes, colorEnabled, options);
    return;
  }

  if ((await tmuxVersion(ctx.runner)) === null) {
    throw new CwError('DEPENDENCY_ERROR', 'tmux is not installed or not on PATH', {
      hint: 'install it with: sudo apt install tmux',
    });
  }
  if (options.claude && (await claudeVersion(ctx.runner)) === null) {
    throw new CwError('DEPENDENCY_ERROR', 'claude (Claude Code) is not installed or not on PATH', {
      hint: 'install Claude Code, or rerun with --no-claude for plain shell panes',
    });
  }

  const tmux = makeTmux(ctx.runner, ctx.tmuxSocketName);
  if (await hasSession(tmux, plan.sessionName)) {
    throw new CwError('WORKSPACE_CONFLICT', `tmux session '${plan.sessionName}' already exists`, {
      hint: `attach with 'cw attach ${plan.name}' or stop it with 'cw stop ${plan.name}'`,
    });
  }

  await createWorkspaceResources(ctx.runner, {
    plan,
    workspacesDir: ctx.paths.workspacesDir,
    worktreesRoot: ctx.paths.worktreesRoot,
    appVersion: ctx.appVersion,
    paneRoles: roles.map((role) => role.id) as [string, string, string, string],
  });

  try {
    await createWorkspaceSession(tmux, {
      session: plan.sessionName,
      colorEnabled,
      panes,
    });
  } catch (error) {
    const steps = await rollbackCreated(ctx.runner, plan.repoRoot, ctx.paths.workspacesDir, {
      worktrees: plan.worktrees,
      manifestName: plan.name,
    });
    throw withRollbackReport(error, steps);
  }

  renderSuccess(ctx, plan, roles, colorEnabled, options);

  if (ctx.isTTY && ctx.env['TMUX'] === undefined) {
    attachSessionInteractive(plan.sessionName, ctx.tmuxSocketName);
  } else if (ctx.env['TMUX'] !== undefined) {
    ctx.stdout(`(already inside tmux — run 'cw attach ${plan.name}' from a detached shell)`);
  }
}

async function buildPaneSpecs(
  ctx: AppContext,
  plan: WorkspacePlan,
  roles: readonly RoleSpec[],
  options: CreateModeOptions,
): Promise<FourPanes> {
  const repoBranch = await git.currentBranchOrCommit(ctx.runner, plan.repoRoot);

  const panes = await Promise.all(
    roles.map(async (role): Promise<PaneSpec> => {
      const worktree = role.workdir === 'repo' ? undefined : plan.worktrees[role.workdir];
      const cwd = worktree?.path ?? plan.repoRoot;
      const context = worktree === undefined ? repoBranch : `${worktree.branch} [wt]`;
      return {
        role: role.label,
        context,
        color: role.color,
        cwd,
        command: await paneCommand(ctx, plan, role, options),
      };
    }),
  );
  return panes as unknown as FourPanes;
}

async function paneCommand(
  ctx: AppContext,
  plan: WorkspacePlan,
  role: RoleSpec,
  options: CreateModeOptions,
): Promise<string> {
  switch (role.kind) {
    case 'claude': {
      if (!options.claude) {
        return bannerShellCommand(
          `${role.label} pane (--no-claude: Claude was not launched).\n` +
            `Role prompt: ${ctx.promptsDir}/${role.promptFile ?? ''}\n` +
            'This is a plain shell in the pane working directory.',
        );
      }
      const systemPrompt = await readRolePrompt(ctx.promptsDir, role.promptFile ?? '');
      const argv = claudeLaunchArgv({
        profile: role.claude ?? {},
        systemPrompt,
        sessionName: `cw ${plan.name} ${role.id}`,
        ...(role.id === 'team-lead' && options.task !== undefined
          ? { initialPrompt: options.task }
          : {}),
      });
      return failureVisibleCommand(shellCommand(argv), role.label);
    }
    case 'workspace-status':
      return workspaceStatusCommand(plan);
    case 'validation':
      return bannerShellCommand(
        'VALIDATION shell.\n' +
          'Run your own checks here (tests, lint, typecheck, build).\n' +
          'cw does not run anything in this pane automatically.',
      );
    case 'git-status':
      return gitStatusCommand();
  }
}

function workspaceStatusCommand(plan: WorkspacePlan): string {
  const header = `cw workspace: ${plan.name} (team mode)`;
  const honesty =
    'Live tmux pane state for this workspace. The Team Lead is a single ' +
    'Claude session; native Claude agent-team coordination is not part of v0.1.0.';
  const format = '#{pane_index}  #{pane_title}  pid #{pane_pid}#{?pane_dead,  [exited],}';
  const body = [
    'clear',
    `printf '%s\\n\\n' ${shellQuote(header)}`,
    'date',
    'echo',
    `tmux list-panes -t ${shellQuote(`=${plan.sessionName}`)} -F ${shellQuote(format)}`,
    'echo',
    `printf '%s\\n' ${shellQuote(honesty)}`,
    'sleep 5',
  ].join('; ');
  return `while :; do ${body}; done`;
}

function gitStatusCommand(): string {
  const body = [
    'clear',
    `printf '%s\\n' ${shellQuote('== branch and working tree ==')}`,
    'git status -sb',
    'echo',
    `printf '%s\\n' ${shellQuote('== recent commits ==')}`,
    'git log --oneline -8',
    'echo',
    `printf '%s\\n' ${shellQuote('== worktrees ==')}`,
    'git worktree list',
    'sleep 5',
  ].join('; ');
  return `while :; do ${body}; done`;
}

function renderDryRun(
  ctx: AppContext,
  plan: WorkspacePlan,
  roles: readonly RoleSpec[],
  panes: FourPanes,
  colorEnabled: boolean,
  options: CreateModeOptions,
): void {
  const paint = makeColorizer(colorEnabled);
  const out = ctx.stdout;
  out(`cw ${plan.mode} '${plan.name}' — dry run (nothing was created)`);
  out('');
  out(`  repository:   ${plan.repoRoot}`);
  out(`  base:         ${plan.baseRef} (${plan.baseCommit.slice(0, 12)})`);
  out(`  tmux session: ${plan.sessionName}`);
  if (plan.worktrees.length === 0) {
    out('  worktrees:    none — team mode runs in the original checkout');
  } else {
    out('  worktrees:');
    for (const worktree of plan.worktrees) {
      out(`    ${worktree.path}`);
      out(`      on new branch ${worktree.branch}`);
    }
  }
  out('');
  out('  panes:');
  for (const [index, pane] of panes.entries()) {
    const role = roles[index];
    out(`    [${index}] ${paint(role?.color ?? 'cyan', paneTitle(pane.role, pane.context))}`);
    out(`        dir: ${pane.cwd}`);
    out(`        cmd: ${pane.command}`);
  }
  out('');
  if (options.mode === 'focus') {
    out('  note: Reviewer and Verifier launch without file-editing tools. This is a');
    out('  workflow safeguard to keep roles honest, not a security sandbox.');
  }
  out('  No branches, worktrees, tmux sessions, or manifests were created.');
}

function renderSuccess(
  ctx: AppContext,
  plan: WorkspacePlan,
  roles: readonly RoleSpec[],
  colorEnabled: boolean,
  options: CreateModeOptions,
): void {
  const paint = makeColorizer(colorEnabled);
  const out = ctx.stdout;
  out(`created workspace '${plan.name}' (${plan.mode})`);
  out(`  tmux session: ${plan.sessionName}`);
  if (plan.worktrees.length > 0) {
    for (const worktree of plan.worktrees) {
      out(`  worktree: ${worktree.path} (${worktree.branch})`);
    }
  }
  out(`  panes: ${roles.map((role) => paint(role.color, role.label)).join(' | ')}`);
  if (!options.claude) {
    out('  Claude was not launched (--no-claude); panes are plain shells.');
  }
  out(
    `  attach: cw attach ${plan.name} · stop: cw stop ${plan.name} · remove: cw clean ${plan.name}`,
  );
}
