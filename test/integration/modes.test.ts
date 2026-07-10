import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli.js';
import { CwError } from '../../src/errors.js';
import { loadManifest } from '../../src/manifest.js';
import { makeTmux, type TmuxExec } from '../../src/tmux.js';
import { cleanupTempDirs, makeTempRepo, makeTestRunner } from '../helpers/repo.js';
import { makeTestContext, type TestContext } from '../helpers/context.js';

const servers: TmuxExec[] = [];

afterEach(async () => {
  for (const tmux of servers.splice(0)) {
    await tmux(['kill-server']);
  }
  await cleanupTempDirs();
});

async function contextInRepo(fakeClaude: boolean): Promise<TestContext & { repoRoot: string }> {
  const repoRoot = await makeTempRepo(makeTestRunner());
  const test = await makeTestContext({ cwd: repoRoot, fakeClaude });
  servers.push(makeTmux(test.runner, test.socketName));
  return { ...test, repoRoot };
}

async function run(test: TestContext, argv: string[]): Promise<void> {
  await createProgram(test.ctx).parseAsync(['node', 'cw', ...argv]);
}

async function paneField(test: TestContext, session: string, field: string): Promise<string[]> {
  const tmux = makeTmux(test.runner, test.socketName);
  const result = await tmux(['list-panes', '-t', `${session}:workspace`, '-F', `#{${field}}`]);
  expect(result.exitCode).toBe(0);
  return result.stdout.trim().split('\n');
}

describe('cw focus', () => {
  it('creates a shared feature worktree behind coordinator/builder/reviewer/verifier panes', async () => {
    const test = await contextInRepo(false);
    await run(test, ['focus', 'demo', '--no-claude']);

    const titles = await paneField(test, 'cw-demo', 'pane_title');
    expect(titles).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/demo [wt]',
      'REVIEWER · cw/demo [wt]',
      'VERIFIER · cw/demo [wt]',
    ]);

    // Coordinator stays in the original checkout; the other three share ONE worktree.
    const dirs = await paneField(test, 'cw-demo', 'pane_current_path');
    expect(dirs[0]).toBe(test.repoRoot);
    expect(new Set(dirs.slice(1)).size).toBe(1);
    expect(dirs[1]).not.toBe(test.repoRoot);
    expect(dirs[1]!.startsWith(test.ctx.paths.worktreesRoot)).toBe(true);

    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    expect(manifest?.ok).toBe(true);
    if (manifest?.ok) {
      expect(manifest.manifest.mode).toBe('focus');
      expect(manifest.manifest.branches).toEqual(['cw/demo']);
      expect(manifest.manifest.paneRoles).toEqual([
        'coordinator',
        'builder',
        'reviewer',
        'verifier',
      ]);
    }
  });

  it('launches role-restricted claude commands via the fake claude', async () => {
    const test = await contextInRepo(true);
    await run(test, ['focus', 'demo']);

    const commands = await paneField(test, 'cw-demo', 'pane_start_command');
    expect(commands[0]).toContain('--permission-mode plan');
    expect(commands[1]).toContain('--permission-mode acceptEdits');
    for (const reviewerLike of [commands[2]!, commands[3]!]) {
      expect(reviewerLike).toContain('--tools Read,Grep,Glob,Bash');
      expect(reviewerLike).toContain('--disallowedTools Edit,Write,NotebookEdit');
    }
    for (const command of commands) {
      expect(command).toContain('--append-system-prompt');
      expect(command).toContain('|| printf');
    }
  });
});

describe('cw parallel', () => {
  it('creates four isolated worktrees and branches', async () => {
    const test = await contextInRepo(false);
    await run(test, ['parallel', 'demo', '--no-claude']);

    const titles = await paneField(test, 'cw-demo', 'pane_title');
    expect(titles).toEqual([
      'TRACK A · cw/demo-a [wt]',
      'TRACK B · cw/demo-b [wt]',
      'TRACK C · cw/demo-c [wt]',
      'TRACK D · cw/demo-d [wt]',
    ]);

    const dirs = await paneField(test, 'cw-demo', 'pane_current_path');
    expect(new Set(dirs).size).toBe(4);
    for (const dir of dirs) {
      expect(dir.startsWith(test.ctx.paths.worktreesRoot)).toBe(true);
    }
  });
});

describe('cw team', () => {
  it('creates a lead pane plus honest status panes and no worktrees', async () => {
    const test = await contextInRepo(true);
    await run(test, ['team', 'release', '--task', 'ship the release checklist']);

    const titles = await paneField(test, 'cw-release', 'pane_title');
    expect(titles).toEqual([
      'TEAM LEAD · main',
      'WORKSPACE STATUS · main',
      'VALIDATION · main',
      'GIT STATUS · main',
    ]);

    const commands = await paneField(test, 'cw-release', 'pane_start_command');
    expect(commands[0]).toContain('ship the release checklist');
    expect(commands[1]).toContain('list-panes');
    expect(commands[2]).toContain('VALIDATION shell');
    expect(commands[3]).toContain('git status -sb');

    const dirs = await paneField(test, 'cw-release', 'pane_current_path');
    expect(new Set(dirs)).toEqual(new Set([test.repoRoot]));

    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'release');
    expect(manifest?.ok).toBe(true);
    if (manifest?.ok) {
      expect(manifest.manifest.worktreePaths).toEqual([]);
      expect(manifest.manifest.branches).toEqual([]);
    }
  });
});

describe('--dry-run', () => {
  it('previews the full plan and mutates nothing', async () => {
    const test = await contextInRepo(false);
    await run(test, ['focus', 'demo', '--dry-run', '--no-color']);

    const output = test.lines.join('\n');
    expect(output).toContain('dry run (nothing was created)');
    expect(output).toContain('cw/demo');
    expect(output).toContain('COORDINATOR');
    expect(output).toContain('not a security sandbox');

    // Nothing on disk, nothing in git, nothing in tmux.
    expect(existsSync(test.ctx.paths.workspacesDir)).toBe(false);
    await expect(readdir(test.ctx.paths.worktreesRoot)).rejects.toThrow();
    const branches = await test.runner('git', ['branch', '--list', 'cw/*'], {
      cwd: test.repoRoot,
    });
    expect(branches.stdout.trim()).toBe('');
    const tmux = makeTmux(test.runner, test.socketName);
    const sessions = await tmux(['has-session', '-t', '=cw-demo']);
    expect(sessions.exitCode).not.toBe(0);
  });
});

describe('creation refusals through the CLI', () => {
  it('refuses to create the same workspace twice', async () => {
    const test = await contextInRepo(false);
    await run(test, ['focus', 'demo', '--no-claude']);
    await expect(run(test, ['focus', 'demo', '--no-claude'])).rejects.toSatisfy(
      (error: unknown) => error instanceof CwError && error.category === 'WORKSPACE_CONFLICT',
    );
  });
});
