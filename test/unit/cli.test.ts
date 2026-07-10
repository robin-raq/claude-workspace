import { describe, expect, it } from 'vitest';
import { APP_VERSION, createProgram, UNOFFICIAL_DISCLAIMER } from '../../src/cli.js';
import { makeTestContext } from '../helpers/context.js';

describe('createProgram', () => {
  it('is named cw and registers the v0.1.0 command set', async () => {
    const { ctx } = await makeTestContext({ cwd: process.cwd() });
    const program = createProgram(ctx);
    expect(program.name()).toBe('cw');
    const commands = program.commands.map((command) => command.name());
    expect(commands).toEqual(expect.arrayContaining(['focus', 'parallel', 'team', 'version']));
  });

  it('exposes the package version', () => {
    expect(APP_VERSION).toBe('0.1.0');
  });

  it('prints version, platform, and the unofficial disclaimer for `cw version`', async () => {
    const { ctx, lines } = await makeTestContext({ cwd: process.cwd() });
    await createProgram(ctx).parseAsync(['node', 'cw', 'version']);
    expect(lines[0]).toBe(`cw ${APP_VERSION}`);
    expect(lines[1]).toContain('WSL 2');
    expect(lines[2]).toBe(UNOFFICIAL_DISCLAIMER);
  });

  it('requires --task for team mode', async () => {
    const { ctx } = await makeTestContext({ cwd: process.cwd() });
    await expect(
      createProgram(ctx).parseAsync(['node', 'cw', 'team', 'demo']),
    ).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
  });
});
