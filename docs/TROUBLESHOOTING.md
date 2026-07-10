# Troubleshooting

Start with:

```bash
cw doctor
```

It checks the platform, required tools, and writable directories, and
prints a remediation line for anything wrong. Most problems end here.

Quick fixes for the most common problems are in the
[README troubleshooting table](../README.md#troubleshooting). This document
goes deeper: how to diagnose each situation, what is safe to do, what not
to delete, and what to include if you need to open an issue.

## Exit codes

Every `cw` error belongs to one category with a stable exit code:

| Code | Category           | Meaning                                                      |
| ---- | ------------------ | ------------------------------------------------------------ |
| 2    | USAGE_ERROR        | Bad arguments, unknown workspace, invalid name               |
| 3    | DEPENDENCY_ERROR   | Missing/old tool, unsupported platform, failed doctor        |
| 4    | GIT_ERROR          | Git refused: dirty checkout, bad base ref, not a repo        |
| 5    | WORKSPACE_CONFLICT | Name/branch/path/session already exists                      |
| 6    | UNSAFE_CLEANUP     | clean refused: dirty worktree, invalid manifest, containment |
| 7    | LAUNCH_ERROR       | tmux/Claude failed to start                                  |

## Installation and PATH

### `cw: command not found` after installing

**Likely cause:** `~/.local/bin` is not on your shell's `PATH`.

**Diagnose:**

```bash
ls -l ~/.local/bin/cw        # does the launcher exist?
echo "$PATH" | tr ':' '\n' | grep -F "$HOME/.local/bin"   # is it on PATH?
```

**Resolve:** if the launcher exists but PATH misses it:

```bash
export PATH="$HOME/.local/bin:$PATH"     # current terminal
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc   # future Bash terminals
```

(Use `~/.zshrc` for Zsh.) If the launcher does not exist, re-run
`./scripts/install.sh` from the clone.

### Installer refuses: "exists and was not installed by claude-workspace"

**Likely cause:** another program already owns `~/.local/bin/cw`. The
installer never overwrites files it did not create.

**Diagnose:** `head ~/.local/bin/cw` — the first lines show what it is.

**Resolve:** if it is a tool you use, keep it; you cannot install
Claude Workspace to that name while it is there. If it is stale and you are
sure you do not need it, move it aside (`mv ~/.local/bin/cw
~/.local/bin/cw.old`) and re-run the installer.

**Do not** delete a file at that path without looking at it first.

### Uninstalling

```bash
./scripts/uninstall.sh --dry-run
./scripts/uninstall.sh
```

The uninstaller removes only the launcher, the installed runtime, and the
install record. Workspace manifests, worktrees, and branches are preserved
on purpose. Run `cw list` and `cw clean <name>` per workspace _before_
uninstalling if you want those gone too — that is safer than deleting
directories by hand, because `cw clean` checks for uncommitted work first.

## Dependencies

### tmux missing or too old

**Symptom:** `cw doctor` flags tmux, or creation fails with a tmux error.
`cw` needs tmux ≥ 3.0 (it uses per-pane options for role labels).

**Diagnose:** `tmux -V`

**Resolve (Ubuntu/WSL):** `sudo apt update && sudo apt install tmux`, then
`cw doctor` again.

### Claude Code missing or not logged in

**Symptom:** `cw doctor` flags claude, or panes show
`[cw] <ROLE>: the pane command exited with an error`.

**Diagnose:** `claude --version` in a normal shell. If the version prints
but panes still fail, read the error text above the `[cw]` line in the
pane — a login prompt or authentication error means Claude Code is not
logged in.

**Resolve:** install and log in to Claude Code, then `cw stop <name>` and
recreate the workspace. To use workspaces without Claude at all, create
them with `--no-claude`.

## Workspace creation

### "has uncommitted changes" (exit 4)

**Cause:** your checkout is dirty. New worktrees start from a commit, so
uncommitted work would silently be missing inside them. `cw` refuses
instead; there is deliberately no override in v0.1.0.

**Diagnose:** `git status`

**Resolve:** commit or `git stash` your changes, then rerun.

### "workspace '<name>' already exists" (exit 5)

**Cause:** `cw` never silently reuses resources.

**Resolve:** `cw attach <name>` to keep using it, or `cw clean <name>` to
remove it, then recreate.

### "branch 'cw/<name>' already exists" (exit 5)

**Cause:** a previous workspace with this name was cleaned — cleaning
preserves branches — or you created the branch yourself.

**Resolve:** choose a different workspace name, or, if you are sure the old
branch is no longer needed:

```bash
git branch -d cw/<name>     # refuses if the branch has unmerged commits
```

Prefer `-d` over `-D`; `-d` is the safe form that refuses to delete
unmerged work.

### "invalid workspace name" (exit 2)

**Cause:** names must be 1–40 lowercase letters, digits, or hyphens,
starting with a letter or digit.

**Resolve:** e.g. `cw focus fix-login`, not `cw focus Fix_Login`.

## Sessions and panes

### A pane says `[cw] <ROLE>: the pane command exited with an error`

**Cause:** the command in that pane (usually `claude`) failed. Panes are
kept open on purpose so you can read the error output above the message.

**Resolve:** read the output, fix the cause (most often: `claude` not
logged in, or not on `PATH` inside tmux), then `cw stop <name>` and
recreate the workspace.

### `cw attach` says the session is not running (exit 2)

**Cause:** the session was stopped, tmux was killed, or the machine
rebooted. tmux sessions do not survive a reboot; worktrees, branches, and
manifests do.

**Diagnose:** `cw list` — the workspace will show `session stopped`.

**Resolve:** v0.1.0 has no session-recreate command. `cw clean <name>`
(your branch survives), then create the workspace again. If the worktree
holds uncommitted work you want, commit it in the worktree first:

```bash
cd ~/.local/share/claude-workspace/worktrees/<repo-container>/<name>
git status && git add -A && git commit -m "wip"
```

### Attaching from inside tmux

`cw attach` refuses to nest tmux sessions and prints the exact
`tmux switch-client -t '=cw-<name>'` command to use instead (works within
the same tmux server).

### Pane labels missing or wrong

**Diagnose:** `tmux -V` must report ≥ 3.0; run `cw doctor`.

**Resolve:** recreate the workspace. If a fresh workspace on tmux ≥ 3.0
still shows missing or wrong labels, that is a bug — open an issue with the
diagnostic bundle below.

### Colors are hard to read

Use `--no-color` on creation, or set `NO_COLOR=1` for everything. Role
labels are always present in the pane borders, so no information is lost.

## Cleanup

### "refusing to clean: uncommitted changes" (exit 6)

**Cause:** a worktree still contains uncommitted work. `cw` refuses to
delete it, and — because all safety checks run before any action — the tmux
session was not stopped either. Nothing changed.

**Resolve:** either commit the work in that worktree (the branch and its
commits survive `cw clean`), or discard it there, then rerun `cw clean`.

**Do not** delete the worktree directory by hand to force the clean; that
loses the uncommitted work and leaves a stale worktree registration in your
repository.

### Stale worktree ("worktree already gone" during clean)

**Cause:** a worktree directory was deleted manually.

**Resolve:** `cw clean` removes its manifest and tells you. If you want the
stale registration gone from Git too, run `git worktree prune` in the
repository yourself — `cw` will not prune, because that command also
touches registrations `cw` may not own.

### Keeping the branch after cleanup

Nothing to do — `cw clean` never deletes branches. It prints each preserved
branch and the manual `git branch -d` command in case you want it gone.

## WSL specifics

### Everything is slow / doctor warns about `/mnt/c`

**Cause:** the repository lives on the Windows filesystem. Git operations
there are typically an order of magnitude slower.

**Resolve:** move the repository into the Linux filesystem, e.g.
`~/projects`, and work there.

### Test leftovers (`cw-test-*` tmux sockets)

The test suite uses isolated tmux sockets and never touches your real tmux
server. If a crashed test run leaves `cw-test-*` sockets in
`/tmp/tmux-$(id -u)/`, they are harmless and disappear on reboot, or kill
one with `tmux -L <name> kill-server`.

## When to open a GitHub issue

Open an issue when:

- `cw doctor` passes but a documented command still fails,
- a safety promise appears broken (a branch deleted, a dirty worktree
  removed, files touched outside `cw`'s own directories),
- pane labels or layout are wrong on a fresh workspace with tmux ≥ 3.0,
- an error message told you something that turned out to be untrue.

### Diagnostic bundle

Run these and paste the output into the issue:

```bash
cw version
cw doctor
cw list
git status
git worktree list
tmux -V
claude --version
```

Add the exact command you ran, its full output, and the exit code
(`echo $?` immediately afterwards).

> **Before pasting:** this output can include repository paths and branch
> names. Check it for anything private, and never paste secrets, API keys,
> tokens, or the content of your Claude conversations into a public issue.
