# Security Policy

## Supported versions

Only the latest release (v0.1.x) is supported.

## Reporting a vulnerability

Please open a GitHub security advisory (Security → Report a vulnerability)
rather than a public issue. You should receive a response within a week.

A useful report includes:

- what you expected `cw` to guarantee, and what actually happened,
- exact reproduction steps (commands and, where relevant, repository
  setup),
- environment: WSL/Linux distribution, and the output of `cw version`,
  `tmux -V`, `node --version`, and `claude --version`,
- the impact you believe it has (what an attacker gains).

**Keep private data out of reports.** Do not include API keys, tokens,
credentials, private source code, or the content of your Claude
conversations. If a reproduction needs a repository, build a minimal
disposable one rather than referencing a real project.

## Security model, honestly stated

### What `cw` guarantees (product safety)

- Local tools (`git`, `tmux`, `claude`) are executed with argument arrays,
  never `shell: true`. The single shell boundary — the command a tmux pane
  runs — is POSIX-quoted and tested against hostile input.
- Workspace names are validated (`^[a-z0-9][a-z0-9-]{0,39}$`), and every
  worktree path is containment-checked against the application data root
  before creation and again before deletion.
- Lifecycle commands only act on resources recorded in a validated
  manifest; branches are never deleted; no Git push/merge/reset/tag/remote
  commands exist in the codebase.
- `cw` makes no network requests itself and stores no credentials.

### What is a workflow safeguard (not a security control)

- The Reviewer/Verifier tool restrictions in focus mode keep roles honest
  during collaboration. They are launch-time flags, not confinement.

### What is not sandboxed

- Claude Code sessions launched by `cw` run with the permissions of your
  user, subject to Claude Code's own permission system. `cw` adds no
  privilege boundary around them and never claims to confine a malicious
  model, prompt, or user.
- The worktrees `cw` creates are ordinary directories your user owns;
  anything running as your user can modify them.

If documentation anywhere appears to promise more than this, treat that as
a reportable bug.
