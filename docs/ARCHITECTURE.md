# Architecture

Claude Workspace (`cw`) is a deliberately compact CLI. It has three jobs:

1. Create application-owned Git worktrees and branches safely.
2. Render a labeled four-pane tmux session for one of three workspace modes.
3. Manage the lifecycle of what it created — and nothing else.

## Module map

```text
src/
├── index.ts        Entry point. Wires real I/O, runs the CLI, maps CwError to exit codes.
├── cli.ts          Commander program definition for all commands. No business logic.
├── errors.ts       CwError with six closed categories and stable exit codes.
├── output.ts       Terminal output helpers: color (util.styleText), NO_COLOR/--no-color,
│                   tables, confirmation prompt.
├── platform.ts     WSL/Linux detection, /mnt/* location warning, XDG path resolution.
├── git.ts          Repository preflight (root, not bare, clean), ref resolution,
│                   worktree add/remove/list, branch creation. Exposes no push, merge,
│                   reset, tag, or remote operations at all.
├── claude.ts       Claude Code presence probe and per-role launch argv construction.
├── tmux.ts         Session/pane creation, tiled layout, role-colored borders and
│                   labels, POSIX shell quoting for pane commands.
├── manifest.ts     Versioned per-workspace JSON manifest: schema (zod), atomic
│                   write (temp file + rename), load/list/delete.
├── workspace.ts    Workspace planning (pure) and plan execution with reverse-order
│                   rollback on partial failure.
├── roles.ts        Role table per mode: label, border color, prompt file,
│                   Claude launch profile.
└── commands/
    ├── focus.ts    cw focus
    ├── parallel.ts cw parallel
    ├── team.ts     cw team
    ├── lifecycle.ts cw list / attach / stop / clean / version
    └── doctor.ts   cw doctor
```

Supporting directories:

- `prompts/` — version-controlled role prompt files shipped with the package.
- `scripts/` — `install.sh` and `uninstall.sh`.
- `test/unit`, `test/integration`, `test/helpers` — see Testing below.

## Design rules

- **Planning is pure.** `workspace.ts` turns (mode, name, options, repository facts)
  into a serializable plan: branches, worktree paths, panes, and the exact commands
  each pane will run. `--dry-run` renders that plan and exits without touching
  anything; tests assert on plans without running tmux or Claude.
- **One injected seam.** Git, tmux, and Claude functions receive a small
  `CommandRunner` (backed by execa in production, a recording fake in tests). This
  exists for testing and safety, not as speculative architecture; there are no
  service containers, registries, or single-implementation interfaces beyond it.
- **No `shell: true`.** All child processes receive argument arrays. The one
  unavoidable shell boundary is the command string tmux runs inside a pane; every
  argument that crosses it goes through a unit-tested POSIX `shellQuote`.
- **Application-owned namespace.** Branches are `cw/<name>[-a..d]`, worktrees live
  under the XDG data directory, tmux sessions are prefixed `cw-`, and lifecycle
  commands refuse to act on anything not recorded in a workspace manifest.
- **Closed error model.** Six categories (`USAGE_ERROR`, `DEPENDENCY_ERROR`,
  `GIT_ERROR`, `WORKSPACE_CONFLICT`, `UNSAFE_CLEANUP`, `LAUNCH_ERROR`) map to exit
  codes 2–7. Messages state what failed, the resource involved, and the next step.

## Workspace modes

| Mode     | Panes                                               | Worktrees                                                                |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| focus    | Coordinator, Builder, Reviewer, Verifier            | One shared feature worktree (Coordinator stays in the original checkout) |
| parallel | Track A–D                                           | Four isolated worktrees, branches `cw/<name>-a..d`                       |
| team     | Team Lead, Workspace Status, Validation, Git Status | No new worktrees; Lead works in the original checkout                    |

Focus mode gives only the Builder normal editing capability; Reviewer and Verifier
launch with read-oriented Claude tool restrictions. These restrictions are
**workflow safeguards, not a security sandbox** — they shape collaboration, they do
not enforce isolation.

Team mode launches one role-prompted Claude session as the lead plus three
informational panes. It does not claim or implement native Claude agent-team
coordination; that is a roadmap item.

## State

One JSON manifest per workspace under the XDG state directory
(`~/.local/state/claude-workspace/workspaces/` by default), containing only what
lifecycle commands need: schema version, app version, workspace id/name, mode,
repository root, tmux session name, base ref, created worktree paths, created
branches, pane roles, and creation timestamp. Manifests are written atomically
(temp file + rename) and validated with zod on read.

Worktrees live under the XDG data directory
(`~/.local/share/claude-workspace/worktrees/<repo-hash>/<workspace>/`). Path
containment beneath that root is verified both at creation and again before any
cleanup.

## Safety model

- Creation refuses a dirty source checkout (no override in v0.1.0).
- Creation refuses name/branch/path/session collisions rather than reusing.
- Partial failures roll back the resources created by the current invocation in
  reverse order, and report which cleanup steps succeeded or failed.
- `cw clean` preflights everything (manifest validity, worktree ownership and
  containment, dirty checks) **before** stopping the tmux session, deletes only
  clean manifest-recorded worktrees, always preserves branches, and prints the
  preserved branch names with optional manual deletion commands.
- `cw` never runs `git push`, `merge`, `reset`, `tag`, or any remote mutation.

## Testing

Unit tests cover the pure logic: validation, path containment, plan generation,
colors, escaping, manifests, cleanup refusal, and Claude argv construction.
Integration tests use real temporary Git repositories, real worktrees, a fake
`claude` executable on `PATH`, an isolated tmux server (`tmux -L` with a private
socket), and a temporary `HOME` for installer tests. Tests never touch the real
tmux server, global Git configuration, Claude settings, or the Claude API.
