# Security Policy

## Supported versions

Only the latest release (v0.1.x) is supported.

## Reporting a vulnerability

Please open a GitHub security advisory (Security → Report a vulnerability)
rather than a public issue. Include reproduction steps and the environment
(WSL/Linux, tmux, Node, Claude Code versions). You should receive a response
within a week.

## Security model, honestly stated

- `cw` executes local tools (`git`, `tmux`, `claude`) with argument arrays,
  never `shell: true`. The single shell boundary — the command a tmux pane
  runs — is POSIX-quoted and tested against hostile input.
- Workspace names are validated (`^[a-z0-9][a-z0-9-]{0,39}$`), and every
  worktree path is containment-checked against the application data root
  before creation and again before deletion.
- Lifecycle commands only act on resources recorded in a validated manifest;
  branches are never deleted; no Git push/merge/reset/tag/remote commands
  exist in the codebase.
- **Not a sandbox:** the Reviewer/Verifier tool restrictions are workflow
  safeguards for role discipline. They do not confine a malicious model or
  user, and `cw` never claims otherwise. Claude Code sessions launched by
  `cw` run with the permissions of your user, subject to Claude Code's own
  permission system.
- `cw` makes no network requests itself and stores no credentials.
