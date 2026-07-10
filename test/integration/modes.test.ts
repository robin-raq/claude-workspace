import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  it('refuses unsupported platforms before touching anything', async () => {
    const repoRoot = await makeTempRepo(makeTestRunner());
    const test = await makeTestContext({
      cwd: repoRoot,
      platform: { kind: 'macos', supported: false, detail: 'macOS is not supported in v0.1.0' },
    });
    await expect(
      createProgram(test.ctx).parseAsync(['node', 'cw', 'focus', 'demo', '--no-claude']),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof CwError && error.category === 'DEPENDENCY_ERROR',
    );
  });
});

describe('--base', () => {
  it('creates the worktree from the requested ref instead of HEAD', async () => {
    const test = await contextInRepo(false);
    // Advance main past a tagged base point.
    await test.runner('git', ['branch', 'base-point'], { cwd: test.repoRoot });
    await writeFile(path.join(test.repoRoot, 'later.txt'), 'after base\n', 'utf8');
    await test.runner('git', ['add', '.'], { cwd: test.repoRoot });
    await test.runner('git', ['commit', '-q', '-m', 'later work'], { cwd: test.repoRoot });

    await run(test, ['focus', 'demo', '--no-claude', '--base', 'base-point']);

    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    expect(manifest?.ok).toBe(true);
    if (manifest?.ok) {
      expect(manifest.manifest.baseRef).toBe('base-point');
      // The worktree starts at base-point, so the later commit's file is absent.
      expect(existsSync(`${manifest.manifest.worktreePaths[0]}/later.txt`)).toBe(false);
      expect(existsSync(`${manifest.manifest.worktreePaths[0]}/README.md`)).toBe(true);
    }
  });

  it('rejects an unknown base ref', async () => {
    const test = await contextInRepo(false);
    await expect(run(test, ['focus', 'demo', '--no-claude', '--base', 'nope'])).rejects.toSatisfy(
      (error: unknown) => error instanceof CwError && error.category === 'GIT_ERROR',
    );
  });
});

describe('dry-run variants', () => {
  it('describes team mode with no worktrees', async () => {
    const test = await contextInRepo(false);
    await run(test, ['team', 'release', '--task', 'plan the release', '--dry-run', '--no-color']);
    const output = test.lines.join('\n');
    expect(output).toContain('none — team mode runs in the original checkout');
    expect(output).not.toContain('not a security sandbox');
  });

  it('lists all four parallel worktrees', async () => {
    const test = await contextInRepo(false);
    await run(test, ['parallel', 'demo', '--dry-run', '--no-color']);
    const output = test.lines.join('\n');
    for (const track of ['a', 'b', 'c', 'd']) {
      expect(output).toContain(`cw/demo-${track}`);
    }
  });
});

describe('inside an existing tmux session', () => {
  it('prints an attach hint instead of nesting', async () => {
    const repoRoot = await makeTempRepo(makeTestRunner());
    const test = await makeTestContext({ cwd: repoRoot, env: { TMUX: '/tmp/fake,1,0' } });
    servers.push(makeTmux(test.runner, test.socketName));
    await createProgram(test.ctx).parseAsync(['node', 'cw', 'focus', 'demo', '--no-claude']);
    expect(test.lines.join('\n')).toContain('already inside tmux');
  });
});
