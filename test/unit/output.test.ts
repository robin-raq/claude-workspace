import { describe, expect, it } from 'vitest';
import { makeColorizer, shouldUseColor } from '../../src/output.js';

describe('shouldUseColor', () => {
  it('enables color by default', () => {
    expect(shouldUseColor({}, false)).toBe(true);
  });

  it('disables color for --no-color', () => {
    expect(shouldUseColor({}, true)).toBe(false);
  });

  it('disables color when NO_COLOR is present, regardless of value', () => {
    expect(shouldUseColor({ NO_COLOR: '1' }, false)).toBe(false);
    expect(shouldUseColor({ NO_COLOR: '' }, false)).toBe(false);
  });
});

describe('makeColorizer', () => {
  it('wraps text in ANSI codes when enabled', () => {
    const paint = makeColorizer(true);
    const painted = paint('cyan', 'COORDINATOR');
    expect(painted).toContain('COORDINATOR');
    expect(painted).toContain('[');
  });

  it('returns plain text when disabled, keeping labels as the signal', () => {
    const paint = makeColorizer(false);
    expect(paint('cyan', 'COORDINATOR')).toBe('COORDINATOR');
  });
});
