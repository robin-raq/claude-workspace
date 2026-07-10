import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Command } from 'commander';
import { claudeVersion } from '../claude.js';
import type { AppContext } from '../context.js';
import { CwError } from '../errors.js';
import { gitVersion, resolveRepoRoot } from '../git.js';
import { makeColorizer, shouldUseColor, type Colorize } from '../output.js';
import { isWindowsMountPath } from '../platform.js';
import { tmuxVersion } from '../tmux.js';

interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  remediation?: string;
}

const MIN_NODE_MAJOR = 22;

async function runChecks(ctx: AppContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(
    ctx.platform.supported
      ? { label: 'platform', status: 'ok', detail: ctx.platform.detail }
      : {
          label: 'platform',
          status: 'fail',
          detail: ctx.platform.detail,
          remediation: 'cw v0.1.0 supports WSL 2 and modern Linux distributions',
        },
  );

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push(
    nodeMajor >= MIN_NODE_MAJOR
      ? { label: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          label: 'node',
          status: 'fail',
          detail: `v${process.versions.node} (need >= ${MIN_NODE_MAJOR})`,
          remediation: 'install Node.js 22 or newer',
        },
  );

  const gitDetail = await gitVersion(ctx.runner);
  checks.push(
    gitDetail !== null
      ? { label: 'git', status: 'ok', detail: gitDetail }
      : {
          label: 'git',
          status: 'fail',
          detail: 'not found on PATH',
          remediation: 'install it with: sudo apt install git',
        },
  );

  const tmuxDetail = await tmuxVersion(ctx.runner);
  checks.push(
    tmuxDetail !== null
      ? { label: 'tmux', status: 'ok', detail: tmuxDetail }
      : {
          label: 'tmux',
          status: 'fail',
          detail: 'not found on PATH',
          remediation: 'install it with: sudo apt install tmux',
        },
  );

  const claudeDetail = await claudeVersion(ctx.runner);
  checks.push(
    claudeDetail !== null
      ? { label: 'claude', status: 'ok', detail: claudeDetail }
      : {
          label: 'claude',
          status: 'warn',
          detail: 'Claude Code not found on PATH',
          remediation: 'install Claude Code to launch role sessions; --no-claude works without it',
        },
  );

  for (const [label, dir] of [
    ['state directory', ctx.paths.workspacesDir],
    ['data directory', ctx.paths.worktreesRoot],
  ] as const) {
    try {
      await mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.cw-doctor-${process.pid}`);
      await writeFile(probe, 'probe\n', 'utf8');
      await rm(probe, { force: true });
      checks.push({ label, status: 'ok', detail: `writable: ${dir}` });
    } catch (error) {
      checks.push({
        label,
        status: 'fail',
        detail: `not writable: ${dir} (${error instanceof Error ? error.message : String(error)})`,
        remediation: 'fix permissions or set XDG_STATE_HOME / XDG_DATA_HOME',
      });
    }
  }

  try {
    const repoRoot = await resolveRepoRoot(ctx.runner, ctx.cwd);
    checks.push(
      isWindowsMountPath(repoRoot)
        ? {
            label: 'repository location',
            status: 'warn',
            detail: `${repoRoot} is on a Windows-mounted filesystem`,
            remediation:
              'Git is much slower under /mnt/*; prefer a path in your WSL home directory',
          }
        : { label: 'repository location', status: 'ok', detail: repoRoot },
    );
  } catch {
    checks.push({
      label: 'repository location',
      status: 'ok',
      detail: 'not inside a Git repository (run cw from a repo to create workspaces)',
    });
  }

  return checks;
}

function renderCheck(ctx: AppContext, paint: Colorize, check: CheckResult): void {
  const mark =
    check.status === 'ok'
      ? paint('green', 'ok  ')
      : check.status === 'warn'
        ? paint('yellow', 'warn')
        : paint('red', 'FAIL');
  ctx.stdout(`  ${mark}  ${check.label.padEnd(20)} ${check.detail}`);
  if (check.remediation !== undefined) {
    ctx.stdout(`        ${''.padEnd(20)} → ${check.remediation}`);
  }
}

export function registerDoctorCommand(program: Command, ctx: AppContext): void {
  program
    .command('doctor')
    .description('Check everything cw needs: platform, tools, and writable directories')
    .option('--no-color', 'disable colored output')
    .action(async (options: { color: boolean }) => {
      const paint = makeColorizer(shouldUseColor(ctx.env, !options.color));
      ctx.stdout(`cw doctor (v${ctx.appVersion})`);
      const checks = await runChecks(ctx);
      for (const check of checks) {
        renderCheck(ctx, paint, check);
      }
      const failed = checks.filter((check) => check.status === 'fail');
      const warned = checks.filter((check) => check.status === 'warn');
      ctx.stdout('');
      if (failed.length > 0) {
        throw new CwError(
          'DEPENDENCY_ERROR',
          `${failed.length} check(s) failed: ${failed.map((check) => check.label).join(', ')}`,
        );
      }
      ctx.stdout(
        warned.length > 0
          ? `all required checks passed (${warned.length} warning${warned.length === 1 ? '' : 's'})`
          : 'all checks passed',
      );
    });
}
