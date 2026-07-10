import { describe, expect, it } from 'vitest';
import { APP_VERSION, createProgram, UNOFFICIAL_DISCLAIMER } from '../../src/cli.js';

function captureIo(): {
  lines: string[];
  io: { stdout: (t: string) => void; stderr: (t: string) => void };
} {
  const lines: string[] = [];
  return {
    lines,
    io: {
      stdout: (text: string) => lines.push(text),
      stderr: (text: string) => lines.push(text),
    },
  };
}

describe('createProgram', () => {
  it('is named cw', () => {
    const { io } = captureIo();
    expect(createProgram(io).name()).toBe('cw');
  });

  it('exposes the package version', () => {
    expect(APP_VERSION).toBe('0.1.0');
  });

  it('prints version and the unofficial disclaimer for `cw version`', async () => {
    const { lines, io } = captureIo();
    await createProgram(io).parseAsync(['node', 'cw', 'version']);
    expect(lines[0]).toBe(`cw ${APP_VERSION}`);
    expect(lines[1]).toBe(UNOFFICIAL_DISCLAIMER);
  });
});
