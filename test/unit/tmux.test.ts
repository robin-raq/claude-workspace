import { describe, expect, it } from 'vitest';
import {
  bannerShellCommand,
  failureVisibleCommand,
  paneBorderFormat,
  shellCommand,
  shellQuote,
} from '../../src/tmux.js';

describe('shellQuote', () => {
  it('leaves safe arguments untouched', () => {
    expect(shellQuote('claude')).toBe('claude');
    expect(shellQuote('--permission-mode')).toBe('--permission-mode');
    expect(shellQuote('/home/dev/repo')).toBe('/home/dev/repo');
    expect(shellQuote('Read,Grep,Glob')).toBe('Read,Grep,Glob');
  });

  it('quotes the empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it.each([
    ['spaces', 'two words', "'two words'"],
    ['semicolons', 'a;rm -rf ~', "'a;rm -rf ~'"],
    ['command substitution', '$(reboot)', "'$(reboot)'"],
    ['backticks', '`reboot`', "'`reboot`'"],
    ['double quotes', 'say "hi"', '\'say "hi"\''],
    ['redirects', 'a > /etc/passwd', "'a > /etc/passwd'"],
    ['ampersands', 'a && b', "'a && b'"],
    ['globs', '*', "'*'"],
    ['variables', '$HOME', "'$HOME'"],
  ])('neutralizes %s', (_label, input, expected) => {
    expect(shellQuote(input)).toBe(expected);
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('keeps newlines and unicode inside one quoted argument', () => {
    expect(shellQuote('line1\nline2')).toBe("'line1\nline2'");
    expect(shellQuote('naïve prompt ✓')).toBe("'naïve prompt ✓'");
  });
});

describe('shellCommand', () => {
  it('joins quoted argv into one command line', () => {
    expect(shellCommand(['claude', '--append-system-prompt', 'be safe; be kind'])).toBe(
      "claude --append-system-prompt 'be safe; be kind'",
    );
  });
});

describe('paneBorderFormat', () => {
  const colors = ['cyan', 'green', 'magenta', 'yellow'] as const;

  it('colors each pane by index with a bright bold active variant', () => {
    const format = paneBorderFormat(colors, true);
    for (const color of colors) {
      expect(format).toContain(`#[fg=${color}]`);
      expect(format).toContain(`#[fg=bright${color} bold]`);
    }
    expect(format).toContain('#{==:#{pane_index},0}');
    expect(format).toContain('#{==:#{pane_index},3}');
    expect(format).toContain('#T');
  });

  it('never colors the pane background', () => {
    expect(paneBorderFormat(colors, true)).not.toContain('bg=');
  });

  it('keeps labels visible without any color codes when color is disabled', () => {
    const format = paneBorderFormat(colors, false);
    expect(format).toContain('#T');
    expect(format).not.toContain('fg=');
    expect(format).toContain('#[bold]');
  });
});

describe('pane command wrappers', () => {
  it('appends a readable failure explanation', () => {
    const wrapped = failureVisibleCommand('claude -n x', 'BUILDER');
    expect(wrapped.startsWith('claude -n x || printf ')).toBe(true);
    expect(wrapped).toContain('BUILDER');
    expect(wrapped).toContain('kept open');
  });

  it('quotes banners safely and hands over to the user shell', () => {
    const command = bannerShellCommand("VALIDATION $(whoami)'s pane");
    expect(command).toContain("'VALIDATION $(whoami)'\\''s pane'");
    expect(command).toContain('exec "${SHELL:-/bin/bash}"');
  });
});
