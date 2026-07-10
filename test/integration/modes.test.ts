import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli.js';
import { CwError } from '../../src/errors.js';
import { loadManifest } from '../../src/manifest.js';
import { makeTmux, type TmuxExec } from '../../src/tmux.js';
import type { CommandRunner } from '../../src/runner.js';
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

    const expectedTitles = [
      'COORDINATOR · main',
      'BUILDER · cw/demo [wt]',
      'REVIEWER · cw/demo [wt]',
      'VERIFIER · cw/demo [wt]',
    ];
    expect(await paneField(test, 'cw-demo', 'pane_title')).toEqual(expectedTitles);
    // The border label is a cw-owned pane option, independent of pane_title.
    expect(await paneField(test, 'cw-demo', '@cw_title')).toEqual(expectedTitles);

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

    const expectedTitles = [
      'TRACK A · cw/demo-a [wt]',
      'TRACK B · cw/demo-b [wt]',
      'TRACK C · cw/demo-c [wt]',
      'TRACK D · cw/demo-d [wt]',
    ];
    expect(await paneField(test, 'cw-demo', 'pane_title')).toEqual(expectedTitles);
    expect(await paneField(test, 'cw-demo', '@cw_title')).toEqual(expectedTitles);

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

    // pane_title is unstable here — the fake claude in the lead pane rewrites
    // its terminal title like the real one — so assert on the cw-owned label.
    const labels = await paneField(test, 'cw-release', '@cw_title');
    expect(labels).toEqual([
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

describe('pane labels with a running (fake) Claude', () => {
  // Regression for the v0.1.0 smoke-gate failure: Claude Code rewrites its
  // terminal title while working, which used to erase the BUILDER border
  // label because the border rendered #{pane_title}.
  it('keeps BUILDER and every other role label after Claude rewrites its title', async () => {
    const test = await contextInRepo(true);
    await run(test, ['focus', 'smoke']);

    // Wait until the fake claude has demonstrably hijacked the pane titles.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const titles = await paneField(test, 'cw-smoke', 'pane_title');
      if (titles.every((title) => title.includes('fake claude working'))) break;
      if (Date.now() > deadline) throw new Error(`titles were never rewritten: ${titles.join()}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(await paneField(test, 'cw-smoke', '@cw_title')).toEqual([
      'COORDINATOR · main',
      'BUILDER · cw/smoke [wt]',
      'REVIEWER · cw/smoke [wt]',
      'VERIFIER · cw/smoke [wt]',
    ]);
  });
});

describe('failure after resources were created', () => {
  it('rolls back the manifest, worktree, and branch when the tmux session cannot be built', async () => {
    const test = await contextInRepo(false);
    const failing: CommandRunner = async (command, args, options) => {
      if (command === 'tmux' && args.includes('select-layout')) {
        return { command, args, stdout: '', stderr: 'injected tmux failure', exitCode: 1 };
      }
      return test.runner(command, args, options);
    };

    await expect(
      createProgram({ ...test.ctx, runner: failing }).parseAsync([
        'node',
        'cw',
        'focus',
        'demo',
        '--no-claude',
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CwError &&
        error.category === 'LAUNCH_ERROR' &&
        error.message.includes('rollback'),
    );

    // Nothing survives: no manifest, no worktree, no branch, no session.
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).toBeNull();
    const branches = await test.runner('git', ['branch', '--list', 'cw/*'], {
      cwd: test.repoRoot,
    });
    expect(branches.stdout.trim()).toBe('');
    const worktrees = await test.runner('git', ['worktree', 'list'], { cwd: test.repoRoot });
    expect(worktrees.stdout.trim().split('\n')).toHaveLength(1);
    const tmux = makeTmux(test.runner, test.socketName);
    expect((await tmux(['has-session', '-t', '=cw-demo'])).exitCode).not.toBe(0);
  });
});

describe('missing dependencies', () => {
  const failCommand =
    (base: CommandRunner, name: string): CommandRunner =>
    async (command, args, options) => {
      if (command === name) {
        return { command, args, stdout: '', stderr: 'not found', exitCode: 127 };
      }
      return base(command, args, options);
    };

  it('reports missing tmux as a DEPENDENCY_ERROR', async () => {
    const test = await contextInRepo(false);
    await expect(
      createProgram({ ...test.ctx, runner: failCommand(test.runner, 'tmux') }).parseAsync([
        'node',
        'cw',
        'focus',
        'demo',
        '--no-claude',
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CwError &&
        error.category === 'DEPENDENCY_ERROR' &&
        error.message.includes('tmux'),
    );
  });

  it('reports missing claude as a DEPENDENCY_ERROR unless --no-claude is given', async () => {
    const test = await contextInRepo(false);
    await expect(
      createProgram({ ...test.ctx, runner: failCommand(test.runner, 'claude') }).parseAsync([
        'node',
        'cw',
        'focus',
        'demo',
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CwError &&
        error.category === 'DEPENDENCY_ERROR' &&
        error.message.includes('claude'),
    );
  });
});

describe('tmux session collisions', () => {
  it('refuses when the session name is taken even without a manifest', async () => {
    const test = await contextInRepo(false);
    const tmux = makeTmux(test.runner, test.socketName);
    await tmux(['new-session', '-d', '-s', 'cw-demo', 'sleep 60']);

    await expect(run(test, ['focus', 'demo', '--no-claude'])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof CwError &&
        error.category === 'WORKSPACE_CONFLICT' &&
        error.message.includes("tmux session 'cw-demo'"),
    );
  });
});
