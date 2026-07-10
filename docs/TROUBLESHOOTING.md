# Troubleshooting

Start with `cw doctor` — it checks the platform, required tools, and
writable directories, and prints a remediation line for anything wrong.

## Exit codes

| Code | Category           | Meaning                                                      |
| ---- | ------------------ | ------------------------------------------------------------ |
| 2    | USAGE_ERROR        | Bad arguments, unknown workspace, invalid name               |
| 3    | DEPENDENCY_ERROR   | Missing/old tool, unsupported platform, failed doctor        |
| 4    | GIT_ERROR          | Git refused: dirty checkout, bad base ref, not a repo        |
| 5    | WORKSPACE_CONFLICT | Name/branch/path/session already exists                      |
| 6    | UNSAFE_CLEANUP     | clean refused: dirty worktree, invalid manifest, containment |
| 7    | LAUNCH_ERROR       | tmux/Claude failed to start                                  |

## Common problems

**"has uncommitted changes"** on create — new worktrees start from a commit
and would not include your uncommitted work. Commit or stash, then rerun.
There is deliberately no override in v0.1.0.

**"workspace 'x' already exists"** — attach (`cw attach x`) or remove it
(`cw clean x`). `cw` never silently reuses resources.

**"refusing to clean: uncommitted changes"** — a worktree contains work.
Nothing was stopped or removed. Commit the work (branches survive `cw
clean`) or discard it in that worktree, then rerun.

**A pane says "[cw] … exited with an error"** — the pane's Claude (or
shell) command failed; the output above the message explains why. Panes are
kept open on purpose (`remain-on-exit`). Typical causes: `claude` not
logged in, or not on PATH inside tmux. Fix, then `cw stop` + recreate.

**`cw: command not found` after install** — `~/.local/bin` is not on your
PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile.

**Attach from inside tmux** — `cw` refuses to nest sessions and prints the
`tmux switch-client -t '=cw-<name>'` command to use instead (same tmux
server only).

**Everything is slow / doctor warns about /mnt/c** — your repo lives on the
Windows filesystem. Move it into WSL (e.g. `~/projects`); Git operations are
typically an order of magnitude faster there.

**Stale worktree registration** ("worktree already gone" during clean) —
someone deleted a worktree directory manually. `cw` removes the manifest and
tells you; run `git worktree prune` in the repository yourself if you want
the stale registration gone (cw won't prune, because that touches
registrations it may not own).

**Colors look wrong / unwanted** — use `--no-color` or set `NO_COLOR=1`.
Role labels are always present in pane titles, so nothing is lost.

**Tests or CI touching your tmux?** They never should: the suite uses
isolated sockets (`tmux -L cw-test-*`) and temp HOME directories. If you see
`cw-test-*` sockets in `ls /tmp/tmux-$(id -u)/`, a crashed run left them;
they are harmless and disappear on reboot, or kill them with
`tmux -L <name> kill-server`.
