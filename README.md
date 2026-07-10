# Claude Workspace (`cw`)

A WSL-first tmux workspace manager for structured [Claude Code](https://claude.com/claude-code)
development sessions.

> **Unofficial project.** Claude Workspace is a community tool. It is not
> affiliated with, endorsed by, or supported by Anthropic. "Claude" and
> "Claude Code" are Anthropic trademarks.

## The problem

Working on a non-trivial task with Claude Code often wants more than one
session: one to build, one to review, one to run the tests — or four
independent attempts at once. Doing that by hand means juggling terminals,
remembering which one is allowed to edit, sharing one working tree between
sessions that step on each other, and cleaning up stray branches and
directories afterwards.

`cw` turns that into one command. It creates a labeled four-pane tmux
session, gives each pane a role-prompted Claude session with the right
working directory and tool posture, isolates work in application-owned Git
worktrees, and can later remove exactly what it created — and nothing else.

## Why not just open four terminals?

- **Roles, not tabs.** Each pane launches Claude with a role prompt
  (Coordinator, Builder, Reviewer, Verifier, …) and a matching permission
  and tool profile, so the review pane can't quietly become a second editor.
- **Worktree discipline.** Panes that should share files share one worktree;
  panes that must not conflict get fully isolated worktrees and branches —
  and the layout tells you which is which.
- **Lifecycle safety.** One manifest records what `cw` owns. `cw clean`
  removes only clean, recorded worktrees, never deletes branches, and
  refuses to destroy uncommitted work.
- **Legible panes.** Colored, labeled borders (cyan/green/magenta/yellow)
  show role, branch, and worktree at a glance — with labels kept visible
  when color is off.

## The three modes

### `cw focus <name>` — one writer, three supporting roles

```text
┌────────────────────────────────┬────────────────────────────────┐
│ COORDINATOR          (cyan)    │ BUILDER              (green)   │
│ original checkout              │ shared feature worktree        │
│ plan mode; keeps intent        │ the only writer                │
├────────────────────────────────┼────────────────────────────────┤
│ REVIEWER            (magenta)  │ VERIFIER             (yellow)  │
│ shared feature worktree        │ shared feature worktree        │
│ read-oriented review           │ runs tests and checks          │
└────────────────────────────────┴────────────────────────────────┘
```

One feature worktree on a new `cw/<name>` branch. Builder, Reviewer, and
Verifier share it, so review and validation always see the Builder's live
uncommitted changes. Reviewer and Verifier launch without file-editing
tools — a workflow safeguard, not a security sandbox.

### `cw parallel <name>` — four isolated attempts

```text
┌────────────────────────────────┬────────────────────────────────┐
│ TRACK A              (cyan)    │ TRACK B              (green)   │
│ worktree · cw/<name>-a         │ worktree · cw/<name>-b         │
├────────────────────────────────┼────────────────────────────────┤
│ TRACK C             (magenta)  │ TRACK D              (yellow)  │
│ worktree · cw/<name>-c         │ worktree · cw/<name>-d         │
└────────────────────────────────┴────────────────────────────────┘
```

Four distinct worktrees on four distinct branches. Every track may edit
freely; files and Git indexes never collide.

### `cw team <name> --task "<task>"` — one lead, full visibility

```text
┌────────────────────────────────┬────────────────────────────────┐
│ TEAM LEAD            (cyan)    │ WORKSPACE STATUS    (magenta)  │
│ Claude session on your task    │ live tmux pane state           │
├────────────────────────────────┼────────────────────────────────┤
│ VALIDATION           (yellow)  │ GIT STATUS           (green)   │
│ your shell for checks          │ branch, tree, recent commits   │
└────────────────────────────────┴────────────────────────────────┘
```

A single role-prompted Claude lead decomposes and drives the task in the
original checkout, next to honest, live status panes. `cw` does not claim
native Claude agent-team coordination — that is on the roadmap.

> **Screenshot placeholder.** Capture with: WSL Ubuntu, a 120×30 or larger
> terminal, `cw focus demo` inside any repo, wait for all four Claude
> sessions to draw, then screenshot the full window showing the four colored
> pane titles. Save as `docs/img/focus-mode.png` and link it here.

## Installation

Prerequisites: WSL 2 (or Linux), Node.js ≥ 22, Git, tmux ≥ 3.0, and optionally
Claude Code. For development you'll also want ShellCheck
(`sudo apt install shellcheck`).

```bash
git clone https://github.com/robin-raq/claude-workspace.git
cd claude-workspace
./scripts/install.sh --dry-run   # preview
./scripts/install.sh             # install
```

The installer builds a **self-contained runtime** in
`~/.local/share/claude-workspace/app/` and a `cw` wrapper in
`~/.local/bin/` — the clone can be moved or deleted afterwards. No sudo, no
changes to your tmux or Claude configuration. Remove it with
`./scripts/uninstall.sh` (workspace state and worktrees are preserved).

Development install instead: `npm install && npm run build && npm link`.

## WSL guidance

`cw` treats WSL 2 as its primary platform and detects it automatically.
Keep repositories in the Linux filesystem (e.g. `~/projects`), not under
`/mnt/c` — Git is dramatically slower on Windows mounts, and `cw doctor`
and workspace creation will warn you. Native Windows outside WSL is not
supported in v0.1.0.

## Quick start

```bash
cd ~/projects/my-repo
cw doctor                      # verify the environment
cw focus login-fix --dry-run   # see exactly what would be created
cw focus login-fix             # create and attach
# ... work ...
cw stop login-fix              # end the session; keep branch + worktree
cw clean login-fix             # remove worktree + manifest; branch preserved
```

## Command reference

| Command                       | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `cw focus <name>`             | Four-pane focus workspace with one shared feature worktree |
| `cw parallel <name>`          | Four fully isolated worktrees and branches                 |
| `cw team <name> --task "<t>"` | Claude team lead plus live status panes                    |
| `cw list`                     | Workspaces with session/worktree/repository health         |
| `cw attach <name>`            | Attach to an existing workspace session                    |
| `cw stop <name>`              | Kill the tmux session; keep branches and worktrees         |
| `cw clean <name>`             | Remove clean worktrees + manifest; always keep branches    |
| `cw doctor`                   | Check platform, tools, and writable directories            |
| `cw version`                  | Version, platform, and disclaimer                          |

Creation flags: `--dry-run`, `--no-claude`, `--no-color`, `--base <ref>`
(and `--task <text>`, required, for team mode). `NO_COLOR` is respected
everywhere.

tmux basics inside a workspace: switch panes `Ctrl-b` + arrows, zoom a pane
`Ctrl-b z`, detach `Ctrl-b d`.

## Safety model

- **Application-owned namespace.** Branches `cw/<name>[-a..d]`, worktrees
  under `~/.local/share/claude-workspace/worktrees/`, tmux sessions
  `cw-<name>`, one validated manifest per workspace. Lifecycle commands
  refuse to touch anything not recorded in a manifest.
- **Creation refuses:** dirty source checkouts (new worktrees would silently
  exclude uncommitted changes), existing branches/paths/sessions/names, and
  unsupported platforms. Partial failures roll back what the invocation
  created, in reverse order, and report each step.
- **`cw clean` preflights before acting:** manifest validity, worktree
  ownership and containment, and dirty checks all happen _before_ the tmux
  session is stopped. Dirty worktree ⇒ nothing is touched. Branches are
  **never** deleted; `cw` prints the `git branch -d` commands for you.
- **No remote mutation, ever.** `cw` runs no push, merge, reset, tag, or
  remote-touching Git command. Its git module doesn't expose them.
- **Role restrictions are workflow safeguards.** Reviewer/Verifier tool
  limits keep roles honest; they are not, and are never described as, a
  security sandbox.
- **No shell interpolation.** Child processes get argument arrays. The only
  shell boundary is the command tmux runs in a pane, and every argument
  crossing it is POSIX-quoted and tested against hostile input.

## Worktree behavior

Focus mode shares **one** worktree between Builder, Reviewer, and Verifier
on purpose: review and verification must see live, uncommitted changes.
Parallel mode gives every track its **own** worktree and branch so four
sessions can edit simultaneously without conflicts. Team mode creates no
worktrees. Worktrees are created with `git worktree add` from your chosen
`--base` (default `HEAD`) and live outside your repository.

## Architecture

A compact TypeScript CLI (strict, ESM, Node ≥ 22): commander for parsing,
zod for manifest validation, execa for child processes; pure workspace
planning (`--dry-run` renders the exact plan), one injected command-runner
seam for tests, and integration tests that use real temp repositories, real
worktrees, an isolated tmux server, and a fake `claude` executable. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). First stop:
`cw doctor`.

## Roadmap (deliberately deferred from v0.1.0)

- Native Claude agent-team integration for team mode, once a documented CLI
  interface exists (Claude Code 2.1.206 exposes none).
- An optional Claude Code status line.
- `cw inspect`, `--json` output, and machine-readable diagnostics.
- Configuration file (worktree root, session prefix, per-role model/effort).
- Workspace reuse (`--reuse`), custom branch names, per-track tasks,
  `--count` for parallel mode.
- Dirty-base override and destructive cleanup overrides (with confirmation).
- A `/smell` review skill and plugin support.
- macOS support and npm publication.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run check` must pass; safety
behavior (cleanup, rollback, containment) needs tests.

## License

[MIT](LICENSE). Unofficial community project — not affiliated with or
endorsed by Anthropic.
