import { describe, expect, it } from 'vitest';
import { createExecaRunner } from '../../src/runner.js';

describe('createExecaRunner', () => {
  it('captures stdout and a zero exit code', async () => {
    const runner = createExecaRunner();
    const result = await runner('node', ['-e', "process.stdout.write('hello')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('reports nonzero exits without throwing', async () => {
    const runner = createExecaRunner();
    const result = await runner('node', ['-e', "process.stderr.write('bad'); process.exit(3)"]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('bad');
  });

  it('reports a missing executable as exit 127 instead of throwing', async () => {
    const runner = createExecaRunner();
    const result = await runner('cw-definitely-not-installed-xyz', ['--version']);
    expect(result.exitCode).toBe(127);
  });

  it('passes per-call environment through to the child', async () => {
    const runner = createExecaRunner({ CW_BASE: 'base' });
    const result = await runner(
      'node',
      ['-e', 'process.stdout.write(process.env.CW_BASE + (process.env.CW_CALL ?? ""))'],
      {
        env: { CW_CALL: '+call' },
      },
    );
    expect(result.stdout).toBe('base+call');
  });
});
