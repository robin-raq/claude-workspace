#!/usr/bin/env bash
# claude-workspace uninstaller.
#
#   ./scripts/uninstall.sh --dry-run   preview every action, change nothing
#   ./scripts/uninstall.sh             uninstall
#
# Removes ONLY what the installer recorded: the cw wrapper, the installed
# runtime directory, and the install record. Workspace manifests, Git
# worktrees, and branches are preserved — remove those with 'cw clean'
# (per workspace) BEFORE uninstalling if you no longer want them.
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "uninstall.sh: unknown option '$arg' (only --dry-run is supported)" >&2
      exit 2
      ;;
  esac
done

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_ROOT="$DATA_HOME/claude-workspace"
APP_DIR="$APP_ROOT/app"
RECORD="$APP_ROOT/install-record.txt"
BIN_DIR="${CW_INSTALL_BIN:-$HOME/.local/bin}"
WRAPPER="$BIN_DIR/cw"
WRAPPER_MARK="# claude-workspace wrapper"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

say() { printf '%s\n' "$*"; }
act() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "[dry-run] $*"
  else
    say "$*"
  fi
}

if [ ! -f "$RECORD" ]; then
  say "no install record at $RECORD."
  if [ -e "$WRAPPER" ] || [ -d "$APP_DIR" ]; then
    say "found leftovers; falling back to signature checks."
  else
    say "nothing to uninstall."
    exit 0
  fi
fi

# Wrapper: remove only if it is provably ours.
if [ -e "$WRAPPER" ]; then
  if grep -qF "$WRAPPER_MARK" "$WRAPPER" 2> /dev/null; then
    act "remove wrapper $WRAPPER"
    [ "$DRY_RUN" -eq 0 ] && rm -f "$WRAPPER"
  else
    say "leaving $WRAPPER alone: it was not installed by claude-workspace."
  fi
fi

if [ -d "$APP_DIR" ]; then
  act "remove installed runtime $APP_DIR"
  [ "$DRY_RUN" -eq 0 ] && rm -rf "$APP_DIR"
fi

if [ -f "$RECORD" ]; then
  act "remove install record $RECORD"
  [ "$DRY_RUN" -eq 0 ] && rm -f "$RECORD"
fi

say ""
say "preserved (never touched by the uninstaller):"
say "  workspace manifests: $STATE_HOME/claude-workspace/workspaces/"
say "  Git worktrees:       $APP_ROOT/worktrees/"
say "  Git branches:        in your repositories (cw/*)"
say "remove those per workspace with 'cw clean <name>' while cw is installed,"
say "or manually with git worktree remove / git branch -d."

if [ "$DRY_RUN" -eq 1 ]; then
  say ""
  say "[dry-run] nothing was changed."
fi
