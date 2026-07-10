import { describe, expect, it } from 'vitest';
import { CwError, exitCodeFor, type ErrorCategory } from '../../src/errors.js';

const EXPECTED: Record<ErrorCategory, number> = {
  USAGE_ERROR: 2,
  DEPENDENCY_ERROR: 3,
  GIT_ERROR: 4,
  WORKSPACE_CONFLICT: 5,
  UNSAFE_CLEANUP: 6,
  LAUNCH_ERROR: 7,
};

describe('CwError', () => {
  it.each(Object.entries(EXPECTED))('maps %s to exit code %d', (category, code) => {
    const error = new CwError(category as ErrorCategory, 'boom');
    expect(error.exitCode).toBe(code);
    expect(exitCodeFor(category as ErrorCategory)).toBe(code);
  });

  it('carries category, message, hint, and cause', () => {
    const cause = new Error('underlying');
    const error = new CwError('GIT_ERROR', 'git failed', { hint: 'try X', cause });
    expect(error.category).toBe('GIT_ERROR');
    expect(error.message).toBe('git failed');
    expect(error.hint).toBe('try X');
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('CwError');
  });

  it('leaves hint undefined when not provided', () => {
    expect(new CwError('USAGE_ERROR', 'bad flag').hint).toBeUndefined();
  });
});
