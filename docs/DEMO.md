# Demo script

How to show Claude Workspace convincingly, in two minutes or five. Every
command is copy-pasteable and runs against a disposable practice
repository, so nothing can touch real work.

## Setup (once, ~1 minute)

```bash
mkdir -p ~/Development/playground/cw-demo
cd ~/Development/playground/cw-demo

git init -b main
echo "# demo" > README.md
git add . && git commit -m "chore: initialize demo repository"

cw doctor
```

`cw doctor` is the opening beat: point out the platform line (WSL 2), the
tool versions, and the writable directories — the whole environment story
in one screen.

## Two-minute demo

Beat 1 — **safety first, dry run** (30s):

```bash
cw focus login-fix --dry-run
```

Point out: every branch, worktree path, pane, and the full command each
pane will run is printed — and nothing was created. Note the closing line:
Reviewer/Verifier restrictions are a workflow safeguard, not a sandbox.

Beat 2 — **the real thing** (60s):

```bash
cw focus login-fix
```

Point out: four colored, labeled panes (COORDINATOR cyan, BUILDER green,
REVIEWER magenta, VERIFIER yellow); you land in the Coordinator; the
Builder pane title shows the `cw/login-fix` branch and worktree marker.

Beat 3 — **leave cleanly** (30s):

`Ctrl-b d` to detach, then:

```bash
cw list
cw stop login-fix
cw clean login-fix
```

Point out the clean output: worktree and manifest removed, branch
`cw/login-fix` explicitly preserved, manual delete command printed.

## Five-minute demo

Do the two-minute demo, but extend Beat 2 before detaching:

- `Ctrl-b →` to the BUILDER pane. Ask it to create a small file.
- `Ctrl-b` + arrows to the REVIEWER pane. Ask it to read the same file —
  it sees the Builder's uncommitted change immediately. That is the shared
  worktree, live.
- Ask the Reviewer to edit a file. It declines: it launched without
  file-editing tools. Say the sentence out loud: _workflow safeguard, not a
  security sandbox_.
- `Ctrl-b z` on the Builder to zoom it full-screen, `Ctrl-b z` to restore.

Then add two more beats:

Beat 4 — **parallel isolation** (1 min):

```bash
cw parallel experiments --no-claude
```

(`--no-claude` opens plain shells — faster for a demo and shows the layout
is useful even without Claude.) Touch a file in TRACK A, run `git status`
in TRACK B: clean. Four branches, four worktrees, zero interference.
Detach, then `cw clean experiments`.

Beat 5 — **team mode** (1 min):

```bash
cw team release --task "Draft a release checklist for this repository"
```

Show the TEAM LEAD working the task while WORKSPACE STATUS and GIT STATUS
update live, and the VALIDATION pane waits as your own shell. Point out the
honesty note in the status pane: this is a single Claude session, not a
native agent team.

## Cleanup

```bash
cw list                          # confirm what exists
cw stop release && cw clean release
cd ~ && rm -rf ~/Development/playground/cw-demo
```

(`cw clean` preserves the `cw/*` branches inside the demo repo; deleting
the whole disposable repo afterwards removes everything.)

## Recording screenshots or GIFs

- Terminal at 120×30 or larger, dark theme, default font, Windows Terminal
  on WSL.
- Wait until all four panes have fully drawn before capturing.
- Screenshot target for the README: the focus-mode window with all four
  colored pane titles visible; save as `docs/img/focus-mode.png`.
- For GIFs: record with `asciinema` and render with `agg`, or use OBS for
  video. Capture the dry-run beat and the focus-mode beat — they tell the
  story fastest.

### Privacy checklist before publishing any capture

- [ ] Recorded inside a disposable repo under `~/Development/playground/`,
      not a real project.
- [ ] No private repository names, customer names, or proprietary code
      visible in any pane.
- [ ] No home-directory paths you would not publish (the demo paths above
      are safe).
- [ ] No email addresses, usernames, tokens, or API keys visible (check
      shell prompts and pane titles).
- [ ] No real Claude conversation content from other sessions.
- [ ] `cw doctor` output checked — it prints local paths; confirm they
      reveal nothing sensitive.
