# Demo script

A ~5 minute walkthrough for showing `cw` on WSL. Every step is copy-paste.

## Setup (once)

```bash
mkdir -p ~/demo && cd ~/demo
git init demo-repo && cd demo-repo
echo "# demo" > README.md && git add . && git commit -m "initial"
cw doctor
```

`cw doctor` is the health-check beat: point out the platform line (WSL 2),
tool versions, and writable directories.

## Beat 1 — dry run first (30s)

```bash
cw focus login-fix --dry-run
```

Talking points: every branch, path, pane, and full pane command is shown;
nothing was created; the note that Reviewer/Verifier restrictions are a
workflow safeguard, not a sandbox.

## Beat 2 — focus mode (2 min)

```bash
cw focus login-fix
```

- Four colored, labeled panes appear; you land in COORDINATOR (cyan).
- `Ctrl-b →` to BUILDER (green): note the pane title shows `cw/login-fix [wt]`.
- In BUILDER, create a file; jump to REVIEWER (magenta) and show the same
  file is visible — shared worktree, live uncommitted changes.
- Show REVIEWER has no Edit/Write tools (ask it to edit a file; it declines).
- `Ctrl-b d` to detach.

```bash
cw list
cw stop login-fix
cw clean login-fix     # prints the preserved branch + manual delete command
```

## Beat 3 — parallel isolation (1 min)

```bash
cw parallel experiments --no-claude
```

Touch a file in TRACK A, `git status` in TRACK B — clean. Four branches,
four worktrees, zero interference. Detach, then `cw clean experiments`.

## Beat 4 — team mode (1 min)

```bash
cw team release --task "Draft a release checklist for this repo"
```

Show the TEAM LEAD working the task while WORKSPACE STATUS and GIT STATUS
update live, and the VALIDATION pane waits as a plain shell. Point out the
status pane's honesty note: this is a single Claude session, not a native
agent team.

## Cleanup

```bash
cw stop release && cw clean release
```

## Recording tips

120×30+ terminal, dark theme, default font. For a GIF, use `asciinema` +
`agg`, or `wf-recorder`/OBS for video. Capture beats 1 and 2 for the README
screenshot (`docs/img/focus-mode.png`).
