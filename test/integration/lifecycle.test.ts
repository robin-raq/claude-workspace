import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../../src/cli.js';
import { CwError } from '../../src/errors.js';
import * as git from '../../src/git.js';
import { loadManifest } from '../../src/manifest.js';
import { hasSession, makeTmux, type TmuxExec } from '../../src/tmux.js';
import { cleanupTempDirs, makeTempRepo, makeTestRunner } from '../helpers/repo.js';
import { makeTestContext, type TestContext } from '../helpers/context.js';

const servers: TmuxExec[] = [];

afterEach(async () => {
  for (const tmux of servers.splice(0)) {
    await tmux(['kill-server']);
  }
  await cleanupTempDirs();
});

async function contextInRepo(): Promise<
  TestContext & { repoRoot: string; tmux: TmuxExec; run: (argv: string[]) => Promise<void> }
> {
  const repoRoot = await makeTempRepo(makeTestRunner());
  const test = await makeTestContext({ cwd: repoRoot });
  const tmux = makeTmux(test.runner, test.socketName);
  servers.push(tmux);
  const run = async (argv: string[]): Promise<void> => {
    await createProgram(test.ctx).parseAsync(['node', 'cw', ...argv]);
  };
  return { ...test, repoRoot, tmux, run };
}

async function expectCategory(promise: Promise<unknown>, category: string): Promise<CwError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CwError);
    expect((error as CwError).category).toBe(category);
    return error as CwError;
  }
  throw new Error('expected rejection');
}

describe('cw list / stop / attach', () => {
  it('tracks a workspace through create, stop, and re-listing', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);

    test.lines.length = 0;
    await test.run(['list', '--no-color']);
    expect(test.lines.join('\n')).toContain('demo');
    expect(test.lines.join('\n')).toContain('running');
    expect(test.lines.join('\n')).toContain('worktrees 1/1');

    // attach in a non-TTY reports how to attach instead of failing.
    test.lines.length = 0;
    await test.run(['attach', 'demo']);
    expect(test.lines.join('\n')).toContain('is running');

    test.lines.length = 0;
    await test.run(['stop', 'demo']);
    expect(await hasSession(test.tmux, 'cw-demo')).toBe(false);
    expect(test.lines.join('\n')).toContain('branches and worktrees were kept');

    // stop is idempotent; worktree and branch survive the stop.
    await test.run(['stop', 'demo']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    expect(manifest?.ok).toBe(true);
    if (manifest?.ok) {
      expect(existsSync(manifest.manifest.worktreePaths[0]!)).toBe(true);
    }
    expect(await git.branchExists(test.runner, test.repoRoot, 'cw/demo')).toBe(true);

    test.lines.length = 0;
    await test.run(['list', '--no-color']);
    expect(test.lines.join('\n')).toContain('stopped');

    await expectCategory(test.run(['attach', 'demo']), 'USAGE_ERROR');
  });

  it('marks invalid manifests in the listing instead of hiding them', async () => {
    const test = await contextInRepo();
    await mkdir(test.ctx.paths.workspacesDir, { recursive: true });
    await writeFile(path.join(test.ctx.paths.workspacesDir, 'corrupt.json'), '{oops', 'utf8');
    await test.run(['list', '--no-color']);
    expect(test.lines.join('\n')).toContain('invalid manifest');
  });

  it('tells a user inside tmux how to switch instead of nesting attach', async () => {
    const repoRoot = await makeTempRepo(makeTestRunner());
    const test = await makeTestContext({ cwd: repoRoot, env: { TMUX: '/tmp/fake,1,0' } });
    const tmux = makeTmux(test.runner, test.socketName);
    servers.push(tmux);
    await createProgram(test.ctx).parseAsync(['node', 'cw', 'focus', 'demo', '--no-claude']);
    test.lines.length = 0;
    await createProgram(test.ctx).parseAsync(['node', 'cw', 'attach', 'demo']);
    expect(test.lines.join('\n')).toContain('switch-client');
  });

  it('rejects unknown workspaces with guidance', async () => {
    const test = await contextInRepo();
    const error = await expectCategory(test.run(['attach', 'ghost']), 'USAGE_ERROR');
    expect(error.hint).toContain('cw list');
    await expectCategory(test.run(['stop', 'ghost']), 'USAGE_ERROR');
    await expectCategory(test.run(['clean', 'ghost']), 'USAGE_ERROR');
  });
});

describe('cw clean', () => {
  it('stops the session, removes clean worktrees, keeps branches, prints manual commands', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    const worktreePath = manifest?.ok ? manifest.manifest.worktreePaths[0]! : '';

    test.lines.length = 0;
    await test.run(['clean', 'demo']);

    expect(await hasSession(test.tmux, 'cw-demo')).toBe(false);
    expect(existsSync(worktreePath)).toBe(false);
    // The now-empty per-repository container the app created is removed too.
    expect(existsSync(path.dirname(worktreePath))).toBe(false);
    expect(existsSync(test.ctx.paths.worktreesRoot)).toBe(true);
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).toBeNull();
    // The branch is ALWAYS preserved.
    expect(await git.branchExists(test.runner, test.repoRoot, 'cw/demo')).toBe(true);
    const output = test.lines.join('\n');
    expect(output).toContain('preserved branches');
    expect(output).toContain(`git -C ${test.repoRoot} branch -d cw/demo`);
  });

  it('keeps the shared container until the last workspace of the repository is cleaned', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'one', '--no-claude']);
    await test.run(['focus', 'two', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'one');
    const container = manifest?.ok ? path.dirname(manifest.manifest.worktreePaths[0]!) : '';

    // Both workspaces share the per-repository container; cleaning one must
    // not disturb the other's worktree.
    await test.run(['clean', 'one']);
    expect(existsSync(container)).toBe(true);
    const remaining = await loadManifest(test.ctx.paths.workspacesDir, 'two');
    expect(remaining?.ok && existsSync(remaining.manifest.worktreePaths[0]!)).toBe(true);

    await test.run(['clean', 'two']);
    expect(existsSync(container)).toBe(false);
  });

  it('never deletes a container that still holds unrelated files, nor sibling directories', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    const container = manifest?.ok ? path.dirname(manifest.manifest.worktreePaths[0]!) : '';

    const stray = path.join(container, 'stray-not-ours.txt');
    await writeFile(stray, 'someone else put this here\n', 'utf8');
    const sibling = path.join(test.ctx.paths.worktreesRoot, 'other-repo-deadbeef');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'keep.txt'), 'unrelated\n', 'utf8');

    await test.run(['clean', 'demo']);

    // Cleanup succeeded, but nothing beyond the empty-directory attempt ran.
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).toBeNull();
    expect(existsSync(container)).toBe(true);
    expect(existsSync(stray)).toBe(true);
    expect(existsSync(path.join(sibling, 'keep.txt'))).toBe(true);
  });

  it('keeps the manifest when a worktree cannot be removed, so clean can be retried', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    const worktreePath = manifest?.ok ? manifest.manifest.worktreePaths[0]! : '';

    // A locked worktree makes 'git worktree remove' fail without --force.
    await test.runner('git', ['worktree', 'lock', worktreePath, '--reason', 'test'], {
      cwd: test.repoRoot,
    });
    const error = await expectCategory(test.run(['clean', 'demo']), 'GIT_ERROR');
    expect(error.message).toContain('could not be removed');
    expect(error.message).toContain('the manifest was kept');
    expect(existsSync(worktreePath)).toBe(true);
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).not.toBeNull();

    // After unlocking, the retry completes the cleanup.
    await test.runner('git', ['worktree', 'unlock', worktreePath], { cwd: test.repoRoot });
    await test.run(['clean', 'demo']);
    expect(existsSync(worktreePath)).toBe(false);
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).toBeNull();
  });

  it('refuses dirty worktrees BEFORE stopping the session or touching anything', async () => {
    const test = await contextInRepo();
    await test.run(['parallel', 'demo', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    expect(manifest?.ok).toBe(true);
    const worktrees = manifest?.ok ? manifest.manifest.worktreePaths : [];

    await writeFile(path.join(worktrees[2]!, 'wip.txt'), 'uncommitted\n', 'utf8');

    const error = await expectCategory(test.run(['clean', 'demo']), 'UNSAFE_CLEANUP');
    expect(error.message).toContain(worktrees[2]!);

    // Amendment 1: the session must still be running and nothing removed.
    expect(await hasSession(test.tmux, 'cw-demo')).toBe(true);
    for (const worktree of worktrees) {
      expect(existsSync(worktree)).toBe(true);
    }
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).not.toBeNull();
  });

  it('refuses when the source repository is gone but worktrees remain', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);
    await test.run(['stop', 'demo']);
    await rm(test.repoRoot, { recursive: true, force: true });

    const error = await expectCategory(test.run(['clean', 'demo']), 'UNSAFE_CLEANUP');
    expect(error.message).toContain('no longer exists');
    // Nothing was deleted: manifest and worktree directory are intact.
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).not.toBeNull();
  });

  it('refuses to act on an invalid manifest', async () => {
    const test = await contextInRepo();
    await mkdir(test.ctx.paths.workspacesDir, { recursive: true });
    await writeFile(
      path.join(test.ctx.paths.workspacesDir, 'broken.json'),
      '{"schemaVersion": 1, "surprise": true}\n',
      'utf8',
    );
    const error = await expectCategory(test.run(['clean', 'broken']), 'UNSAFE_CLEANUP');
    expect(error.message).toContain('cannot prove what it owns');
  });

  it('handles a manually deleted worktree directory and still removes the manifest', async () => {
    const test = await contextInRepo();
    await test.run(['focus', 'demo', '--no-claude']);
    const manifest = await loadManifest(test.ctx.paths.workspacesDir, 'demo');
    const worktreePath = manifest?.ok ? manifest.manifest.worktreePaths[0]! : '';
    await test.run(['stop', 'demo']);
    await rm(worktreePath, { recursive: true, force: true });

    test.lines.length = 0;
    await test.run(['clean', 'demo']);
    const output = test.lines.join('\n');
    expect(output).toContain('worktree already gone');
    expect(output).toContain('git worktree prune');
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'demo')).toBeNull();
    // Branch still preserved even in this degraded path.
    expect(await git.branchExists(test.runner, test.repoRoot, 'cw/demo')).toBe(true);
  });

  it('cleans a team workspace (no worktrees, no branches)', async () => {
    const test = await contextInRepo();
    await test.run(['team', 'release', '--task', 'x', '--no-claude']);
    test.lines.length = 0;
    await test.run(['clean', 'release']);
    expect(test.lines.join('\n')).toContain('no branches were created');
    expect(await loadManifest(test.ctx.paths.workspacesDir, 'release')).toBeNull();
  });
});

describe('cw doctor', () => {
  it('passes on a healthy environment', async () => {
    const test = await contextInRepo();
    await test.run(['doctor', '--no-color']);
    const output = test.lines.join('\n');
    expect(output).toContain('platform');
    expect(output).toContain('git');
    expect(output).toContain('tmux');
    expect(output).toContain('writable');
    expect(output).toMatch(/all (required )?checks passed/);
  });

  it('fails when the state directory is not writable', async () => {
    const repoRoot = await makeTempRepo(makeTestRunner());
    const test = await makeTestContext({ cwd: repoRoot });
    await mkdir(path.dirname(test.ctx.paths.workspacesDir), { recursive: true });
    await mkdir(test.ctx.paths.workspacesDir, { recursive: true });
    const { chmod } = await import('node:fs/promises');
    await chmod(test.ctx.paths.workspacesDir, 0o555);
    try {
      const error = await expectCategory(
        createProgram(test.ctx).parseAsync(['node', 'cw', 'doctor', '--no-color']),
        'DEPENDENCY_ERROR',
      );
      expect(error.message).toContain('state directory');
    } finally {
      await chmod(test.ctx.paths.workspacesDir, 0o755);
    }
  });

  it('fails with DEPENDENCY_ERROR on an unsupported platform', async () => {
    const repoRoot = await makeTempRepo(makeTestRunner());
    const test = await makeTestContext({
      cwd: repoRoot,
      platform: { kind: 'windows', supported: false, detail: 'native Windows' },
    });
    await expectCategory(
      createProgram(test.ctx).parseAsync(['node', 'cw', 'doctor', '--no-color']),
      'DEPENDENCY_ERROR',
    );
  });

  describe('tmux version handling', () => {
    async function doctorWithTmux(
      versionOutput: string | null,
    ): Promise<{ run: () => Promise<void>; lines: string[] }> {
      const repoRoot = await makeTempRepo(makeTestRunner());
      const test = await makeTestContext({ cwd: repoRoot });
      const runner: typeof test.runner = async (command, args, options) => {
        if (command === 'tmux' && args[0] === '-V') {
          return versionOutput === null
            ? { command, args, stdout: '', stderr: 'not found', exitCode: 127 }
            : { command, args, stdout: `${versionOutput}\n`, stderr: '', exitCode: 0 };
        }
        return test.runner(command, args, options);
      };
      const ctx = { ...test.ctx, runner };
      return {
        run: async () => {
          await createProgram(ctx).parseAsync(['node', 'cw', 'doctor', '--no-color']);
        },
        lines: test.lines,
      };
    }

    it('fails when tmux is missing', async () => {
      const doctor = await doctorWithTmux(null);
      const error = await expectCategory(doctor.run(), 'DEPENDENCY_ERROR');
      expect(error.message).toContain('tmux');
      expect(doctor.lines.join('\n')).toContain('not found on PATH');
    });

    it('fails when tmux is older than the minimum', async () => {
      const doctor = await doctorWithTmux('tmux 2.9');
      const error = await expectCategory(doctor.run(), 'DEPENDENCY_ERROR');
      expect(error.message).toContain('tmux');
      expect(doctor.lines.join('\n')).toContain('need >= 3.0');
    });

    it('warns but passes on unrecognizable version output', async () => {
      const doctor = await doctorWithTmux('tmux master');
      await doctor.run();
      const output = doctor.lines.join('\n');
      expect(output).toContain("unrecognized version output 'tmux master'");
      expect(output).toContain('all required checks passed');
    });

    it('passes at the exact minimum and on newer versions', async () => {
      for (const version of ['tmux 3.0', 'tmux 3.6']) {
        const doctor = await doctorWithTmux(version);
        await doctor.run();
        expect(doctor.lines.join('\n')).toContain(version);
      }
    });
  });
});
