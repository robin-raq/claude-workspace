import { existsSync } from 'node:fs';
import { rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import type { AppContext } from '../context.js';
import { CwError } from '../errors.js';
import * as git from '../git.js';
import {
  deleteManifest,
  listManifestNames,
  loadManifest,
  type WorkspaceManifest,
} from '../manifest.js';
import { makeColorizer, shouldUseColor } from '../output.js';
import { attachSessionInteractive, hasSession, killSession, makeTmux } from '../tmux.js';
import { assertContained } from '../workspace.js';

async function requireManifest(
  ctx: AppContext,
  name: string,
  invalidCategory: 'USAGE_ERROR' | 'UNSAFE_CLEANUP',
): Promise<WorkspaceManifest> {
  const load = await loadManifest(ctx.paths.workspacesDir, name);
  if (load === null) {
    throw new CwError('USAGE_ERROR', `no workspace named '${name}'`, {
      hint: "run 'cw list' to see known workspaces",
    });
  }
  if (!load.ok) {
    throw new CwError(
      invalidCategory,
      `the manifest for '${name}' is invalid and cw cannot prove what it owns (${load.reason})`,
      { hint: `inspect ${ctx.paths.workspacesDir}/${name}.json and repair or remove it manually` },
    );
  }
  return load.manifest;
}

export function registerLifecycleCommands(program: Command, ctx: AppContext): void {
  program
    .command('list')
    .description('List cw workspaces and whether their sessions and worktrees still exist')
    .option('--no-color', 'disable colored output')
    .action(async (options: { color: boolean }) => {
      const paint = makeColorizer(shouldUseColor(ctx.env, !options.color));
      const names = await listManifestNames(ctx.paths.workspacesDir);
      if (names.length === 0) {
        ctx.stdout('no workspaces. create one with: cw focus <name>');
        return;
      }
      const tmux = makeTmux(ctx.runner, ctx.tmuxSocketName);
      for (const name of names) {
        const load = await loadManifest(ctx.paths.workspacesDir, name);
        if (load === null || !load.ok) {
          ctx.stdout(
            `${paint('red', name.padEnd(20))} invalid manifest${load === null ? '' : `: ${load.reason}`}`,
          );
          continue;
        }
        const manifest = load.manifest;
        const running = await hasSession(tmux, manifest.tmuxSession);
        const session = running ? paint('green', 'running') : paint('yellow', 'stopped');
        const present = manifest.worktreePaths.filter((path) => existsSync(path)).length;
        const worktrees =
          manifest.worktreePaths.length === 0
            ? 'none'
            : `${present}/${manifest.worktreePaths.length}`;
        const repo = existsSync(manifest.repoRoot)
          ? manifest.repoRoot
          : paint('red', `${manifest.repoRoot} (missing)`);
        ctx.stdout(
          `${paint('cyan', name.padEnd(20))} ${manifest.mode.padEnd(8)} session ${session}  worktrees ${worktrees}  ${repo}`,
        );
      }
    });

  program
    .command('attach <name>')
    .description('Attach the terminal to an existing workspace tmux session')
    .action(async (name: string) => {
      const manifest = await requireManifest(ctx, name, 'USAGE_ERROR');
      const tmux = makeTmux(ctx.runner, ctx.tmuxSocketName);
      if (!(await hasSession(tmux, manifest.tmuxSession))) {
        throw new CwError('USAGE_ERROR', `tmux session '${manifest.tmuxSession}' is not running`, {
          hint: `the workspace still exists; recreate the session by cleaning and re-creating it, or remove it with 'cw clean ${name}'`,
        });
      }
      if (ctx.env['TMUX'] !== undefined) {
        ctx.stdout(
          `already inside tmux — switch with: tmux switch-client -t '=${manifest.tmuxSession}'`,
        );
        return;
      }
      if (!ctx.isTTY) {
        ctx.stdout(
          `session '${manifest.tmuxSession}' is running; attach from an interactive terminal with: tmux attach -t '=${manifest.tmuxSession}'`,
        );
        return;
      }
      const status = attachSessionInteractive(manifest.tmuxSession, ctx.tmuxSocketName);
      if (status !== 0) {
        throw new CwError('LAUNCH_ERROR', `tmux attach exited with status ${status}`);
      }
    });

  program
    .command('stop <name>')
    .description('Stop the workspace tmux session; branches and worktrees are kept')
    .action(async (name: string) => {
      const manifest = await requireManifest(ctx, name, 'USAGE_ERROR');
      const tmux = makeTmux(ctx.runner, ctx.tmuxSocketName);
      if (!(await hasSession(tmux, manifest.tmuxSession))) {
        ctx.stdout(`session '${manifest.tmuxSession}' is not running — nothing to stop`);
        return;
      }
      await killSession(tmux, manifest.tmuxSession);
      ctx.stdout(`stopped session '${manifest.tmuxSession}'`);
      ctx.stdout(`branches and worktrees were kept; remove them later with 'cw clean ${name}'`);
    });

  program
    .command('clean <name>')
    .description('Remove the workspace: stop its session, delete clean worktrees, keep branches')
    .action(async (name: string) => {
      // 1. Load and validate the manifest — it is the proof of ownership.
      const manifest = await requireManifest(ctx, name, 'UNSAFE_CLEANUP');

      // 2. Every recorded worktree must sit beneath the application root.
      for (const worktreePath of manifest.worktreePaths) {
        assertContained(ctx.paths.worktreesRoot, worktreePath, 'UNSAFE_CLEANUP');
      }
      const presentWorktrees = manifest.worktreePaths.filter((path) => existsSync(path));
      if (presentWorktrees.length > 0 && !existsSync(manifest.repoRoot)) {
        throw new CwError(
          'UNSAFE_CLEANUP',
          `the source repository '${manifest.repoRoot}' no longer exists, so its worktrees cannot be removed through Git`,
          { hint: 'remove the worktree directories manually, then rerun cw clean' },
        );
      }

      // 3-4. Inspect for uncommitted changes BEFORE touching anything.
      const dirty: string[] = [];
      for (const worktreePath of presentWorktrees) {
        if (await git.isDirty(ctx.runner, worktreePath)) {
          dirty.push(worktreePath);
        }
      }
      if (dirty.length > 0) {
        throw new CwError(
          'UNSAFE_CLEANUP',
          `refusing to clean '${name}': uncommitted changes in\n  ${dirty.join('\n  ')}`,
          {
            hint: 'commit or discard those changes, then rerun. Nothing was stopped or removed.',
          },
        );
      }

      // 5. Only now stop the session.
      const tmux = makeTmux(ctx.runner, ctx.tmuxSocketName);
      if (await hasSession(tmux, manifest.tmuxSession)) {
        await killSession(tmux, manifest.tmuxSession);
        ctx.stdout(`stopped session '${manifest.tmuxSession}'`);
      }

      // 6. Remove only the clean, manifest-recorded worktrees.
      const failures: string[] = [];
      for (const worktreePath of manifest.worktreePaths) {
        if (!existsSync(worktreePath)) {
          ctx.stdout(`worktree already gone: ${worktreePath}`);
          ctx.stdout(
            "  (a stale Git registration may remain; run 'git worktree prune' yourself if desired)",
          );
          continue;
        }
        try {
          await git.removeWorktree(ctx.runner, manifest.repoRoot, worktreePath);
          ctx.stdout(`removed worktree: ${worktreePath}`);
        } catch (error) {
          failures.push(
            `${worktreePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new CwError(
          'GIT_ERROR',
          `some worktrees could not be removed; the manifest was kept so you can retry:\n  ${failures.join('\n  ')}`,
        );
      }

      // 6.5. Remove the per-repository container directory the application
      // created for these worktrees — but only when it is now empty. The
      // container is shared by every workspace of the same repository, so
      // anything stronger than an rmdir would risk other workspaces' data.
      const containers = new Set(
        manifest.worktreePaths.map((worktreePath) => path.dirname(worktreePath)),
      );
      for (const container of containers) {
        try {
          assertContained(ctx.paths.worktreesRoot, container, 'UNSAFE_CLEANUP');
        } catch {
          continue; // never touch a directory outside the application root
        }
        try {
          await rmdir(container);
          ctx.stdout(`removed empty worktree container: ${container}`);
        } catch {
          // Still holds other workspaces' worktrees (or is already gone);
          // leave it exactly as it is.
        }
      }

      // 7. Remove the manifest.
      await deleteManifest(ctx.paths.workspacesDir, name);
      ctx.stdout(`removed workspace manifest for '${name}'`);

      // 8. Branches are always preserved; show how to delete them manually.
      if (manifest.branches.length === 0) {
        ctx.stdout('no branches were created by this workspace.');
        return;
      }
      ctx.stdout('preserved branches (cw never deletes branches):');
      for (const branch of manifest.branches) {
        ctx.stdout(`  ${branch}`);
      }
      ctx.stdout('delete them manually if you no longer need them:');
      for (const branch of manifest.branches) {
        ctx.stdout(`  git -C ${manifest.repoRoot} branch -d ${branch}`);
      }
    });
}
