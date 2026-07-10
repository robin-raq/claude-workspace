# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-10

Initial release.

### Added

- `cw focus <name>` — four-pane workspace: Coordinator (plan mode, original
  checkout) plus Builder/Reviewer/Verifier sharing one feature worktree on a
  new `cw/<name>` branch; Builder is the only writer, Reviewer/Verifier get
  read-oriented tool restrictions (workflow safeguard, not a sandbox).
- `cw parallel <name>` — four fully isolated worktrees on `cw/<name>-a..d`.
- `cw team <name> --task "<t>"` — a role-prompted Claude team lead plus live
  workspace-status, validation-shell, and Git-status panes. No native
  agent-team claims.
- `cw list`, `cw attach`, `cw stop`, `cw clean`, `cw doctor`, `cw version`.
- `--dry-run`, `--no-claude`, `--no-color`, `--base <ref>` on creation
  commands; `NO_COLOR` respected everywhere.
- Role-colored tmux pane borders and titles (cyan/green/magenta/yellow,
  bright+bold active pane) with always-visible labels.
- Safe worktree lifecycle: dirty-base refusal, collision refusal,
  reverse-order rollback on partial failure, preflight-first `clean` that
  never deletes branches or dirty worktrees.
- Self-contained installer/uninstaller (`scripts/install.sh`,
  `scripts/uninstall.sh`) targeting `~/.local`, with `--dry-run`.
- 188 unit and integration tests (real temp repositories, isolated tmux
  servers, fake `claude`, temp-HOME installer tests).
