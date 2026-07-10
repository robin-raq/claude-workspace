import { describe, expect, it } from 'vitest';
import {
  bannerShellCommand,
  createWorkspaceSession,
  failureVisibleCommand,
  paneBorderFormat,
  paneTitle,
  shellCommand,
  shellQuote,
  truncateContext,
  type SessionSpec,
  type TmuxExec,
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

describe('paneTitle / truncateContext', () => {
  it('joins the role label and context', () => {
    expect(paneTitle('BUILDER', 'cw/real-claude-smoke')).toBe('BUILDER · cw/real-claude-smoke');
  });

  it('truncates a long context with an ellipsis instead of the role label', () => {
    const branch = `cw/${'very-long-feature-name-'.repeat(4)}x [wt]`;
    const title = paneTitle('BUILDER', branch);
    expect(title.startsWith('BUILDER · cw/very-long-feature-name-')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThan(`BUILDER · ${branch}`.length);
    expect(truncateContext(branch).endsWith('…')).toBe(true);
  });

  it('never truncates the role label itself', () => {
    const title = paneTitle('WORKSPACE STATUS', 'a'.repeat(200));
    expect(title.startsWith('WORKSPACE STATUS · ')).toBe(true);
  });

  it('leaves short contexts untouched', () => {
    expect(paneTitle('VERIFIER', 'main')).toBe('VERIFIER · main');
    expect(truncateContext('main')).toBe('main');
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
    expect(format).toContain('#{@cw_role}');
  });

  it('never colors the pane background', () => {
    expect(paneBorderFormat(colors, true)).not.toContain('bg=');
  });

  it('keeps labels visible without any color codes when color is disabled', () => {
    const format = paneBorderFormat(colors, false);
    expect(format).toContain('#{@cw_role}');
    expect(format).not.toContain('fg=');
    expect(format).toContain('#[bold]');
  });

  it('renders the cw-owned role option first, never the process-writable pane title', () => {
    for (const colorEnabled of [true, false]) {
      const format = paneBorderFormat(colors, colorEnabled);
      expect(format).toContain('#{@cw_role}');
      expect(format).toContain('#{@cw_context}');
      // The role renders before the context, so width pressure cuts metadata.
      expect(format.indexOf('#{@cw_role}')).toBeLessThan(format.indexOf('#{@cw_context}'));
      expect(format).not.toContain('#T');
      expect(format).not.toContain('pane_title');
    }
  });
});

describe('createWorkspaceSession role assignment', () => {
  function spec(): SessionSpec {
    const pane = (role: string, color: SessionSpec['panes'][0]['color']) => ({
      role,
      context: 'cw/demo [wt]',
      color,
      cwd: '/tmp',
      command: 'true',
    });
    return {
      session: 'cw-demo',
      colorEnabled: true,
      panes: [
        pane('COORDINATOR', 'cyan'),
        pane('BUILDER', 'green'),
        pane('REVIEWER', 'magenta'),
        pane('VERIFIER', 'yellow'),
      ],
    };
  }

  it('sets exactly one @cw_role per pane, in pane-index order', async () => {
    const calls: string[][] = [];
    // Split order in createWorkspaceSession: bottom-left, top-right,
    // bottom-right. Returning these ids yields paneIds [%0, %1, %2, %3].
    const splitIds = ['%2', '%1', '%3'];
    let splits = 0;
    const fake: TmuxExec = (args) => {
      calls.push(args);
      let stdout = '';
      if (args[0] === 'list-panes') stdout = '%0';
      if (args[0] === 'split-window') stdout = splitIds[splits++] ?? '';
      return Promise.resolve({ command: 'tmux', args, stdout, stderr: '', exitCode: 0 });
    };

    await createWorkspaceSession(fake, spec());

    const roleAssignments = calls
      .filter((args) => args[0] === 'set-option' && args.includes('@cw_role'))
      .map((args) => [args[args.indexOf('-t') + 1], args[args.length - 1]]);
    expect(roleAssignments).toEqual([
      ['%0', 'COORDINATOR'],
      ['%1', 'BUILDER'],
      ['%2', 'REVIEWER'],
      ['%3', 'VERIFIER'],
    ]);
    // Exactly one assignment per pane id.
    expect(new Set(roleAssignments.map(([id]) => id)).size).toBe(4);
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
