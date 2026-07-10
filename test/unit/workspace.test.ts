import { describe, expect, it } from 'vitest';
import { CwError } from '../../src/errors.js';
import {
  assertContained,
  planWorkspace,
  repoKey,
  sessionNameFor,
  validateWorkspaceName,
  withRollbackReport,
  type PlanInputs,
} from '../../src/workspace.js';

function expectCwError(fn: () => unknown, category: string, messagePart?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CwError);
    expect((error as CwError).category).toBe(category);
    if (messagePart !== undefined) {
      expect((error as CwError).message).toContain(messagePart);
    }
    return;
  }
  throw new Error('expected the call to throw');
}

describe('validateWorkspaceName', () => {
  it.each(['auth', 'fix-login', 'a', 'x1', 'a'.repeat(40)])('accepts %s', (name) => {
    expect(() => validateWorkspaceName(name)).not.toThrow();
  });

  it.each([
    '',
    'Auth',
    '-auth',
    'auth_login',
    'auth.login',
    '../escape',
    'a/b',
    'a b',
    'a'.repeat(41),
    '..',
    '$(rm -rf ~)',
  ])('rejects %j as USAGE_ERROR', (name) => {
    expectCwError(() => validateWorkspaceName(name), 'USAGE_ERROR');
  });
});

describe('assertContained', () => {
  const root = '/data/worktrees';

  it('accepts paths beneath the root', () => {
    expect(() => assertContained(root, '/data/worktrees/repo-abc/auth')).not.toThrow();
  });

  it.each([
    '/data/worktrees',
    '/data/worktrees/../elsewhere',
    '/data/other',
    '/data/worktrees-evil/x',
    '/etc/passwd',
  ])('rejects %s', (candidate) => {
    expectCwError(() => assertContained(root, candidate), 'USAGE_ERROR', 'not contained');
  });

  it('uses the requested category for cleanup callers', () => {
    expectCwError(() => assertContained(root, '/etc', 'UNSAFE_CLEANUP'), 'UNSAFE_CLEANUP');
  });
});

describe('planWorkspace', () => {
  const baseInputs: PlanInputs = {
    mode: 'focus',
    name: 'auth',
    repoRoot: '/home/dev/repo',
    worktreesRoot: '/home/dev/.local/share/claude-workspace/worktrees',
    baseRef: 'HEAD',
    baseCommit: 'abc123',
    now: () => new Date('2026-07-10T00:00:00.000Z'),
    randomId: () => 'aaaaaa',
  };

  it('plans one shared feature worktree for focus mode', () => {
    const plan = planWorkspace(baseInputs);
    expect(plan.sessionName).toBe('cw-auth');
    expect(plan.worktrees).toHaveLength(1);
    expect(plan.worktrees[0]?.branch).toBe('cw/auth');
    expect(plan.worktrees[0]?.path).toContain(`/${repoKey('/home/dev/repo')}/auth`);
    expect(plan.createdAt).toBe('2026-07-10T00:00:00.000Z');
    expect(plan.id).toBe('auth-aaaaaa');
  });

  it('plans four isolated worktrees with a-d branches for parallel mode', () => {
    const plan = planWorkspace({ ...baseInputs, mode: 'parallel' });
    expect(plan.worktrees.map((worktree) => worktree.branch)).toEqual([
      'cw/auth-a',
      'cw/auth-b',
      'cw/auth-c',
      'cw/auth-d',
    ]);
    const paths = new Set(plan.worktrees.map((worktree) => worktree.path));
    expect(paths.size).toBe(4);
  });

  it('plans no worktrees for team mode', () => {
    const plan = planWorkspace({ ...baseInputs, mode: 'team' });
    expect(plan.worktrees).toHaveLength(0);
  });

  it('rejects invalid names before planning anything', () => {
    expectCwError(() => planWorkspace({ ...baseInputs, name: '../bad' }), 'USAGE_ERROR');
  });
});

describe('repoKey / sessionNameFor', () => {
  it('derives a stable, distinct key per repository path', () => {
    expect(repoKey('/home/dev/repo')).toBe(repoKey('/home/dev/repo'));
    expect(repoKey('/home/dev/repo')).not.toBe(repoKey('/home/dev/repo2'));
    expect(repoKey('/home/dev/repo')).toMatch(/^repo-[0-9a-f]{8}$/);
  });

  it('prefixes tmux sessions with cw-', () => {
    expect(sessionNameFor('auth')).toBe('cw-auth');
  });
});

describe('withRollbackReport', () => {
  it('keeps the original category and appends step outcomes', () => {
    const wrapped = withRollbackReport(new CwError('GIT_ERROR', 'worktree add failed'), [
      { action: 'remove worktree', target: '/x', ok: true },
      { action: 'delete branch (created this run)', target: 'cw/x', ok: false, error: 'busy' },
    ]);
    expect(wrapped.category).toBe('GIT_ERROR');
    expect(wrapped.message).toContain('worktree add failed');
    expect(wrapped.message).toContain('ok: remove worktree /x');
    expect(wrapped.message).toContain('FAILED: delete branch (created this run) cw/x (busy)');
  });

  it('reports when nothing had been created yet', () => {
    const wrapped = withRollbackReport(new CwError('GIT_ERROR', 'boom'), []);
    expect(wrapped.message).toContain('nothing had been created yet');
  });

  it('wraps non-CwError failures as LAUNCH_ERROR', () => {
    const wrapped = withRollbackReport(new Error('spawn failed'), []);
    expect(wrapped.category).toBe('LAUNCH_ERROR');
    expect(wrapped.message).toContain('spawn failed');
  });
});
