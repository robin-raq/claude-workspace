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

## tmux sessions and pane labels

Each workspace is one tmux session (`cw-<name>`) with one window split into
four panes (tiled layout). The window gets `pane-border-status: top` and a
`pane-border-format` that renders each pane's role label and context (branch
plus a worktree marker) in the role's color, with the active pane bold.

The label data lives in **application-owned pane-scoped user options** —
`@cw_role` and `@cw_context`, set with `set-option -p` — not in the pane
title. This distinction matters: `pane_title` is mutable by whatever runs
inside the pane (interactive programs, including Claude Code, routinely set
the terminal title, which tmux maps onto the pane title). If the border
rendered `pane_title`, labels would be overwritten moments after launch.
User options are cw's own namespace; nothing else writes them, so the
COORDINATOR/BUILDER/REVIEWER/VERIFIER labels stay correct for the life of
the session. `pane_title` is still set once as a courtesy for other tools
that display it, but nothing cw renders depends on it. Pane-scoped user
options are the reason for the tmux ≥ 3.0 requirement (`MIN_TMUX_VERSION`
in `src/tmux.ts`).

Panes get `remain-on-exit: on` so a failed command leaves its error output
readable instead of vanishing, with a `[cw] <ROLE>: … exited with an error`
trailer explaining what to do next.

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

Manifests are the ownership proof: lifecycle commands act only on resources a
manifest records, so `cw` cannot be talked into stopping sessions, removing
worktrees, or reporting on directories it did not create.

## Safety model

- Creation refuses a dirty source checkout (no override in v0.1.0).
- Creation refuses name/branch/path/session collisions rather than reusing.
- Partial failures roll back the resources created by the current invocation in
  reverse order, and report which cleanup steps succeeded or failed.
- `cw clean` preflights everything (manifest validity, worktree ownership and
  containment, dirty checks) **before** stopping the tmux session, deletes only
  clean manifest-recorded worktrees, always preserves branches, and prints the
  preserved branch names with optional manual deletion commands. The ordering
  is deliberate: if any check fails, the session is still running and nothing
  has changed.
- Branches are preserved because they are the only durable record of the work:
  a worktree directory is reproducible from its branch, but a deleted branch
  with unmerged commits is real loss. Deleting branches stays a human decision
  (`git branch -d`, which itself refuses unmerged work).
- `cw` never runs `git push`, `merge`, `reset`, `tag`, or any remote mutation.

## Installer ownership

`scripts/install.sh` builds the project, stages a self-contained runtime
(dist, prompts, package.json, production `node_modules`) and atomically swaps
it into `~/.local/share/claude-workspace/app/`, then writes a marked wrapper
script to `~/.local/bin/cw` and an install record listing exactly what it
owns. The marker and record define ownership: the installer refuses to
overwrite a `cw` it did not write, and `scripts/uninstall.sh` removes only the
wrapper (if marked), the runtime directory, and the record. Workspace state,
worktrees, and branches are never touched by either script. Everything is
user-space; no sudo.

## Trust boundaries

`cw` orchestrates local tools with the invoking user's permissions; it adds
no privilege boundary of its own. Concretely:

- Claude Code sessions launched in panes are ordinary `claude` processes
  running as your user, governed by Claude Code's own permission system.
- The Reviewer/Verifier tool restrictions are launch-time flags — workflow
  safeguards, not containment of a malicious model or user.
- `cw` itself makes no network requests and stores no credentials; its state
  is plain JSON manifests and Git worktrees on the local disk.
- The one shell boundary (the command string a pane runs) is POSIX-quoted and
  tested against hostile input; all other child processes get argument arrays.

## Testing

Unit tests cover the pure logic: validation, path containment, plan generation,
colors, escaping, manifests, cleanup refusal, and Claude argv construction.
Integration tests use real temporary Git repositories, real worktrees, a fake
`claude` executable on `PATH`, an isolated tmux server (`tmux -L` with a private
socket), and a temporary `HOME` for installer tests. Tests never touch the real
tmux server, global Git configuration, Claude settings, or the Claude API.
