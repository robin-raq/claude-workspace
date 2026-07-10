# Claude Workspace (`cw`)

Claude Workspace is a WSL-first command-line tool that opens structured
four-pane [tmux](https://github.com/tmux/tmux/wiki) workspaces for
[Claude Code](https://claude.com/claude-code) and safely manages the Git
worktrees behind them.

Instead of juggling terminals by hand, you run one command — `cw focus`,
`cw parallel`, or `cw team` — and get a labeled, color-coded workspace where
each pane has a clear role, the right working directory, and a safe place to
put its work. When you are done, `cw clean` removes exactly what `cw`
created and nothing else.

> **Unofficial project.** Claude Workspace is a community tool. It is not
> affiliated with, endorsed by, or supported by Anthropic. "Claude" and
> "Claude Code" are Anthropic trademarks.

## Contents

- [What it looks like](#what-it-looks-like)
- [Who this is for](#who-this-is-for)
- [Requirements](#requirements)
- [Installation](#installation)
- [Five-minute tutorial](#five-minute-tutorial)
- [Command reference](#command-reference)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Understanding worktrees](#understanding-worktrees)
- [Safety model](#safety-model)
- [Common workflows](#common-workflows)
- [Troubleshooting](#troubleshooting)
- [Uninstallation](#uninstallation)
- [Architecture](#architecture)
- [Limitations and roadmap](#limitations-and-roadmap)
- [Contributing, security, and license](#contributing-security-and-license)

## What it looks like

### `cw focus <name>` — one writer, three supporting roles

```text
┌──────────────────┬──────────────────┐
│ COORDINATOR      │ BUILDER          │
├──────────────────┼──────────────────┤
│ REVIEWER         │ VERIFIER         │
└──────────────────┴──────────────────┘
```

- **Coordinator** (cyan) plans. It runs in your original checkout, in
  Claude's plan mode, and keeps track of what "done" means.
- **Builder** (green) edits. It is the only pane intended to write code.
- **Reviewer** (magenta) inspects the Builder's work and reports findings.
- **Verifier** (yellow) runs tests and checks and reports honest results.

Builder, Reviewer, and Verifier share **one** feature worktree on a new
`cw/<name>` branch, so review and verification always see the Builder's
live, uncommitted changes. Reviewer and Verifier launch without
file-editing tools — a workflow safeguard, not a security sandbox.

### `cw parallel <name>` — four isolated attempts

```text
┌──────────────────┬──────────────────┐
│ TRACK A          │ TRACK B          │
├──────────────────┼──────────────────┤
│ TRACK C          │ TRACK D          │
└──────────────────┴──────────────────┘
```

All four tracks get their **own** branch (`cw/<name>-a` through
`cw/<name>-d`) and their own worktree. Every track can edit freely; files
and Git state never collide. Use this to try four independent approaches to
the same problem at once.

### `cw team <name> --task "<task>"` — one lead, full visibility

```text
┌──────────────────┬──────────────────┐
│ TEAM LEAD        │ WORKSPACE STATUS │
├──────────────────┼──────────────────┤
│ VALIDATION       │ GIT STATUS       │
└──────────────────┴──────────────────┘
```

One role-prompted Claude session (the Team Lead) works on your task in the
original checkout, next to a live workspace-status pane, a live Git-status
pane, and a plain shell for your own validation commands. Team mode is a
lead-and-observability workspace — it is a single Claude session, **not**
native Claude agent-team coordination (that is a roadmap item).

## Who this is for

Claude Workspace is for developers who use Claude Code inside WSL or Linux
and want more than one Claude session on a task without managing the
terminals, branches, and directories themselves. Typical uses:

- Building a feature with a separate reviewer and test-runner watching the
  same work.
- Trying several independent solutions to one problem side by side.
- Keeping one Claude session on a long task while status panes show you
  what is actually happening in the repository.

You do not need to know tmux or Git worktrees to start — the
[five-minute tutorial](#five-minute-tutorial) below explains both as you go.

## Requirements

- WSL 2 (Ubuntu or similar), or a modern Linux distribution.
- Node.js 22 or newer, with npm.
- Git (the tutorial's `git init -b main` needs Git 2.28 or newer).
- tmux 3.0 or newer.
- Claude Code, installed and logged in. (Every workspace also works with
  `--no-claude`, which opens plain shells instead.)
- A terminal with normal ANSI color support — on Windows, Windows Terminal
  works well.

Check what you have:

```bash
node --version
npm --version
git --version
tmux -V
claude --version
```

If tmux is missing on Ubuntu/WSL: `sudo apt install tmux`.

After installing `cw`, you can re-check everything in one step:

```bash
cw doctor
```

**Not supported in v0.1.0:** native Windows outside WSL, and macOS.

## Installation

Run these commands from any directory. No `sudo` is needed.

```bash
git clone https://github.com/robin-raq/claude-workspace.git
cd claude-workspace
./scripts/install.sh --dry-run   # preview: prints what would happen, changes nothing
./scripts/install.sh             # install
hash -r                          # make your shell notice the new command
cw doctor                        # verify the installation
```

What the installer does:

- Builds the tool and installs a **self-contained runtime** under
  `~/.local/share/claude-workspace/app/`.
- Writes a small `cw` launcher script to `~/.local/bin/cw`.
- Records what it installed in
  `~/.local/share/claude-workspace/install-record.txt`, so the uninstaller
  can later remove exactly those files.
- Never touches your tmux configuration, your Claude settings, or any Git
  repository.

Because the runtime is self-contained, the cloned `claude-workspace`
directory can be moved or deleted after installation — `cw` keeps working.

Re-running the installer is safe; it replaces the previous installation of
itself. If something unrelated already exists at `~/.local/bin/cw`, the
installer refuses to overwrite it and tells you.

### If `cw` is not found after installing

Your shell probably does not have `~/.local/bin` on its `PATH` (the list of
directories it searches for commands). Fix it for the current terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

To make that permanent, append it to your shell's startup file (these
commands add a line; they do not overwrite anything):

```bash
# Bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

# Zsh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

### Where should my projects live?

Keep repositories in the Linux filesystem (for example `~/projects`), not
under `/mnt/c`. Git is dramatically slower on Windows-mounted paths, and
both `cw doctor` and workspace creation will warn you about it.

## Five-minute tutorial

This walkthrough uses a fresh, disposable practice repository, so nothing
you do here can affect real work.

First, a few words in plain language:

- **tmux** is a terminal multiplexer: one terminal window split into
  several independent panes, each running its own shell. tmux sessions keep
  running even when you disconnect from them.
- A **Git branch** is a named line of work in a repository. Committing on
  branch `cw/first-feature` does not change `main`.
- A **Git worktree** is an extra working directory attached to the same
  repository, checked out on its own branch. Two worktrees of one
  repository are two separate folders that share one Git history.
- The **original checkout** is the repository folder you ran `cw` from.
- The **feature worktree** is the extra folder `cw` creates for the work,
  on a new `cw/<name>` branch, stored under
  `~/.local/share/claude-workspace/worktrees/` — outside your repository.
- A **dirty working tree** has uncommitted changes. `cw` refuses to build
  workspaces from a dirty checkout and refuses to delete dirty worktrees,
  because both could lose work.

### 1. Create a practice repository

```bash
mkdir -p ~/Development/playground/cw-first-project
cd ~/Development/playground/cw-first-project

git init -b main
git commit --allow-empty -m "chore: initialize project"
```

### 2. Preview, then create a focus workspace

Run these from inside the practice repository:

```bash
cw focus first-feature --dry-run
```

The dry run prints everything that _would_ be created — the branch, the
worktree path, the tmux session name, and the exact command each pane will
run — and creates nothing. It is always safe.

Now create it for real:

```bash
cw focus first-feature
```

Your terminal switches into a tmux session named `cw-first-feature` with
four labeled panes: COORDINATOR (cyan), BUILDER (green), REVIEWER
(magenta), and VERIFIER (yellow). Each pane starts a Claude session with
its role instructions already loaded. You land in the Coordinator pane.

On disk, two things were created:

- a new branch `cw/first-feature` in your repository, and
- a feature worktree on that branch under
  `~/.local/share/claude-workspace/worktrees/`, shared by the Builder,
  Reviewer, and Verifier panes. The Coordinator stays in your original
  checkout.

(To explore the same layout with plain shells and no Claude sessions, you
could have added `--no-claude` when creating the workspace. Each workspace
name can only exist once, so to try it later, clean this workspace first or
pick a new name.)

### 3. Move around

`Ctrl-b` is the tmux **prefix**: press `Ctrl-b`, release it, _then_ press
the next key.

- Move between panes: `Ctrl-b`, release, then an arrow key.
- Zoom one pane to full size (and back): `Ctrl-b`, then `z`.
- Scroll a pane's history: `Ctrl-b`, then `[` — arrow keys/PageUp scroll,
  `q` returns to normal.

Try it: ask the Builder pane to create a file, then move to the Reviewer
pane and ask it to read the same file. Both see the same worktree,
including uncommitted changes.

### 4. Leave and come back

Detach from the session (everything keeps running in the background):

```text
Ctrl-b, then d
```

You are back in your normal terminal. From there:

```bash
cw list                    # shows: first-feature · session running · worktrees 1/1
cw attach first-feature    # jump back into the running session
```

### 5. Stop and clean up

Detach again (`Ctrl-b`, then `d`), then:

```bash
cw stop first-feature      # end the tmux session; branch and worktree are kept
cw clean first-feature     # remove the worktree and cw's records of the workspace
```

`cw clean` first checks that the worktree has no uncommitted changes — if
it does, it refuses and nothing is touched. After a successful clean:

- The tmux session is gone.
- The worktree directory is gone.
- `cw`'s manifest (its record of the workspace) is gone.
- **The branch `cw/first-feature` still exists in your repository.** `cw`
  never deletes branches. It prints the exact `git branch -d` command you
  can run yourself if you no longer want the branch.

That is the entire lifecycle: preview, create, work, detach, reattach,
stop, clean.

## Command reference

Run all creation commands from inside the Git repository you want to work
on. `<name>` is 1–40 lowercase letters, digits, or hyphens, starting with a
letter or digit.

| Command                          | Purpose                                                                                      | Example                                              | Safety behavior                                                                                      | Creates / removes                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cw focus <name>`                | Four-pane workspace: Coordinator plus Builder/Reviewer/Verifier sharing one feature worktree | `cw focus login-fix`                                 | Refuses dirty checkouts and name/branch/path/session collisions; rolls back on partial failure       | Creates branch `cw/<name>`, one worktree, tmux session `cw-<name>`, one manifest |
| `cw parallel <name>`             | Four isolated tracks, each in its own worktree and branch                                    | `cw parallel ideas`                                  | Same refusals and rollback as focus                                                                  | Creates branches `cw/<name>-a..d`, four worktrees, one session, one manifest     |
| `cw team <name> --task "<task>"` | One Claude team lead plus live workspace, validation, and Git panes                          | `cw team release --task "Draft a release checklist"` | Same refusals; `--task` is required                                                                  | Creates one session and one manifest; no worktrees or branches                   |
| `cw list`                        | Show every workspace, its session state, and worktree health                                 | `cw list`                                            | Read-only                                                                                            | Nothing                                                                          |
| `cw attach <name>`               | Re-enter a running workspace session                                                         | `cw attach login-fix`                                | Read-only; refuses to nest inside tmux and prints the `tmux switch-client` command instead           | Nothing                                                                          |
| `cw stop <name>`                 | End the tmux session but keep all work                                                       | `cw stop login-fix`                                  | Never touches branches or worktrees                                                                  | Removes only the tmux session                                                    |
| `cw clean <name>`                | Remove the workspace completely, except branches                                             | `cw clean login-fix`                                 | Preflights safety checks _before_ stopping anything; refuses dirty worktrees; never deletes branches | Removes session, clean worktrees, and manifest                                   |
| `cw doctor`                      | Check platform, tools, and writable directories                                              | `cw doctor`                                          | Read-only                                                                                            | Nothing                                                                          |
| `cw version`                     | Print version, platform, and disclaimer                                                      | `cw version`                                         | Read-only                                                                                            | Nothing                                                                          |

Flags on the creation commands (`focus`, `parallel`, `team`):

| Flag            | Meaning                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`     | Print everything that would be created — branches, paths, panes, full pane commands — and create nothing             |
| `--no-claude`   | Open plain shells in the panes instead of launching Claude                                                           |
| `--no-color`    | Disable colored output and pane borders (labels stay visible); the `NO_COLOR` environment variable is also respected |
| `--base <ref>`  | Base commit for new worktrees (default: `HEAD`)                                                                      |
| `--task <text>` | Team mode only, **required**: the task handed to the Team Lead                                                       |

`cw list` and `cw doctor` also accept `--no-color`. `cw --version` (or
`-V`) prints just the version number; `cw version` prints the fuller
version, platform, and disclaimer lines.

## Keyboard shortcuts

These are standard tmux shortcuts; `cw` does not install custom global
shortcuts or modify your tmux configuration.

| Action             | Keys                 |
| ------------------ | -------------------- |
| Move between panes | `Ctrl-b`, then arrow |
| Zoom/restore pane  | `Ctrl-b z`           |
| Detach             | `Ctrl-b d`           |
| Scroll/copy mode   | `Ctrl-b [`           |
| Leave copy mode    | `q`                  |

> `Ctrl-b` is the tmux prefix. Press and release it before pressing the
> next key.

Outside the session, use `cw attach <name>` to return, `cw stop <name>` to
end it, and `cw clean <name>` to remove it.

## Understanding worktrees

A worktree is an extra folder checked out from the same repository on its
own branch. `cw` uses worktrees so Claude sessions can work without
touching your original checkout. The two creation modes use them
differently, on purpose:

```text
focus:
main checkout
└── one cw/feature worktree shared by Builder, Reviewer, Verifier

parallel:
main checkout
├── cw/task-a worktree
├── cw/task-b worktree
├── cw/task-c worktree
└── cw/task-d worktree
```

- **Focus shares one worktree** because the Reviewer and Verifier must see
  the Builder's live, uncommitted changes. A review of stale files is
  worthless. Sharing is safe here because only the Builder is meant to
  write.
- **Parallel isolates four worktrees** because all four tracks edit at the
  same time. Separate worktrees on separate branches mean their files and
  Git state can never collide.
- **Team creates no worktrees** — the lead works in your original checkout.

Worktrees are created with `git worktree add` from your chosen `--base`
(default: `HEAD`) and live under
`~/.local/share/claude-workspace/worktrees/`, outside your repository.

## Safety model

- **Creation refuses a dirty checkout.** New worktrees start from a commit,
  so your uncommitted changes would silently not be in them. Commit or
  stash first. There is deliberately no override in v0.1.0.
- **Dirty worktrees are never auto-deleted.** `cw clean` checks every
  worktree first; if one has uncommitted changes, nothing is stopped or
  removed. Commit or discard the work, then rerun.
- **Branches are never deleted.** Your commits survive every `cw` command.
  `cw clean` prints the manual `git branch -d` commands instead.
- **Checks run before actions.** `cw clean` validates its manifest, confirms
  every worktree is one it created (recorded and contained under `cw`'s own
  data directory), and runs dirty checks — all _before_ the tmux session is
  stopped.
- **Manifests are ownership records.** Each workspace has one JSON manifest
  under `~/.local/state/claude-workspace/workspaces/`. Lifecycle commands
  refuse to touch anything not recorded there. This is why `cw clean` is
  safer than deleting directories by hand: it removes exactly what `cw`
  created, verifies it is safe to do so, and keeps Git's worktree records
  consistent.
- **No remote Git mutation, ever.** `cw` runs no push, merge, reset, tag, or
  remote-touching Git command; its Git layer does not expose them.
- **Role restrictions are workflow safeguards, not a security sandbox.**
  Reviewer and Verifier launch without file-editing tools to keep the roles
  honest. This does not confine a malicious model or user; Claude Code
  sessions run with your user's permissions, subject to Claude Code's own
  permission system.
- **Failed creation cleans up after itself.** If workspace creation fails
  partway, `cw` rolls back what that invocation created, in reverse order,
  and reports each step.

## Common workflows

Build one feature with review and verification:

```bash
cd ~/projects/my-repo
cw focus login-fix
```

Investigate four independent ideas at once:

```bash
cw parallel caching-ideas
```

Run a lead-and-observability session on one task:

```bash
cw team release-prep --task "Draft a release checklist for this repository"
```

Preview without creating anything (works on all three modes):

```bash
cw focus login-fix --dry-run
```

Test the layout without launching Claude:

```bash
cw focus login-fix --no-claude
```

Resume a detached session:

```bash
cw list
cw attach login-fix
```

End a session but keep the worktree and branch for later:

```bash
cw stop login-fix
```

Remove a finished workspace (branch survives):

```bash
cw clean login-fix
```

## Troubleshooting

First stop, always:

```bash
cw doctor
```

| Problem                                          | Solution                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cw: command not found`                          | `~/.local/bin` is not on your `PATH`. Run `export PATH="$HOME/.local/bin:$PATH"`, and persist it as shown in [Installation](#installation)                                                            |
| tmux is missing                                  | `sudo apt install tmux`, then `cw doctor`                                                                                                                                                             |
| tmux version below 3.0                           | `cw` needs tmux ≥ 3.0 for per-pane labels. Upgrade: `sudo apt update && sudo apt install tmux`                                                                                                        |
| Claude Code is missing                           | Install Claude Code and log in, or use `--no-claude` to work with plain shells                                                                                                                        |
| `has uncommitted changes` when creating          | Your checkout is dirty. `git status`, then commit or `git stash`, then rerun                                                                                                                          |
| `workspace '<name>' already exists`              | Reuse it (`cw attach <name>`) or remove it (`cw clean <name>`)                                                                                                                                        |
| `branch 'cw/<name>' already exists`              | Pick a different workspace name, or delete the stale branch yourself: `git branch -d cw/<name>`                                                                                                       |
| `refusing to clean: uncommitted changes`         | A worktree still holds work; nothing was removed. Commit it (the branch survives `cw clean`) or discard it in that worktree, then rerun                                                               |
| A pane says `[cw] … exited with an error`        | The pane's command failed; the output above the message says why (commonly: `claude` not logged in). Panes stay open so you can read the error. `cw stop`, fix, recreate                              |
| `cw attach` says the session is not running      | The session was stopped or the machine rebooted. `cw list` to confirm, then `cw clean <name>` and recreate the workspace                                                                              |
| Warning about `/mnt/c`                           | Your repository is on the Windows filesystem. Move it into WSL (e.g. `~/projects`) — Git is far faster there                                                                                          |
| Pane labels missing or wrong                     | Confirm `tmux -V` reports ≥ 3.0 and run `cw doctor`; if labels are still wrong in a fresh workspace, open an issue with the diagnostic bundle from [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Colors hard to read                              | Add `--no-color` or set `NO_COLOR=1`. Role labels remain visible                                                                                                                                      |
| Want to keep the branch after cleanup            | You already do — `cw clean` never deletes branches                                                                                                                                                    |
| Want to uninstall                                | See [Uninstallation](#uninstallation) — workspaces and branches are preserved                                                                                                                         |
| Installer refuses to overwrite `~/.local/bin/cw` | Something else owns that name. Inspect it (`head ~/.local/bin/cw`); move or remove it only if you are sure, then reinstall                                                                            |

Deeper diagnosis, exit codes, and what to include in a bug report:
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Uninstallation

From a clone of this repository:

```bash
./scripts/uninstall.sh --dry-run   # preview
./scripts/uninstall.sh             # uninstall
```

The uninstaller removes only what the installer recorded: the `cw` launcher
in `~/.local/bin`, the runtime under `~/.local/share/claude-workspace/app/`,
and the install record. It never removes:

- workspace manifests (`~/.local/state/claude-workspace/workspaces/`),
- Git worktrees (`~/.local/share/claude-workspace/worktrees/`),
- any Git branch in any repository.

That preservation is intentional: uninstalling the application is not the
same as cleaning workspaces. If you want workspaces gone too, run `cw list`
and `cw clean <name>` for each workspace _before_ uninstalling — cleaning
through `cw` is safer than deleting directories by hand.

## Architecture

`cw` is a compact, strict-TypeScript CLI. In one paragraph: commands are
planned as pure data (which is what `--dry-run` prints), then executed —
Git worktrees via `git worktree add`, panes via tmux with role labels
stored in application-owned pane metadata, Claude launched per role with a
role prompt file, and one JSON manifest written per workspace as the
ownership record that lifecycle commands trust. The installer is a plain
shell script targeting your user directories; nothing needs root.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limitations and roadmap

v0.1.0 limitations, stated plainly:

- WSL 2 / Linux only. No native Windows, no macOS.
- Team mode is a single Claude lead with status panes — no native Claude
  agent-team integration.
- No configuration file; behavior is fixed apart from the documented flags.
- No workspace reuse or resume command beyond `cw attach`.
- No Claude Code status-line integration.
- Not published to npm; installation is from a clone.
- No automatic branch deletion (by design — see [Safety model](#safety-model)).

Possible future work (no promised dates): native agent-team integration
for team mode once a documented CLI interface exists, a status line,
`--json` output and `cw inspect`, a configuration file, workspace reuse,
per-track tasks and `--count` for parallel mode, opt-in destructive
overrides with confirmation, a `/smell` review skill, macOS support, and
npm publication.

## Contributing, security, and license

- Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). `npm run check`
  must pass; safety behavior needs tests.
- Security policy and honest security model: see [SECURITY.md](SECURITY.md).
- License: [MIT](LICENSE). Unofficial community project — not affiliated
  with or endorsed by Anthropic.
