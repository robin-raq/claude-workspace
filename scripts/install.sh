#!/usr/bin/env bash
# claude-workspace installer: builds cw and installs a self-contained runtime.
#
#   ./scripts/install.sh --dry-run   preview every action, change nothing
#   ./scripts/install.sh             install
#
# Layout after installation (XDG_DATA_HOME honored, no sudo ever needed):
#   ~/.local/share/claude-workspace/app/            dist/, prompts/, package.json,
#                                                   production node_modules/
#   ~/.local/share/claude-workspace/install-record.txt
#   ~/.local/bin/cw                                 wrapper -> installed runtime
#
# The installed cw does NOT depend on this clone staying where it is.
# Workspace state, Git worktrees, and branches are never touched here.
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "install.sh: unknown option '$arg' (only --dry-run is supported)" >&2
      exit 2
      ;;
  esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_ROOT="$DATA_HOME/claude-workspace"
APP_DIR="$APP_ROOT/app"
STAGE_DIR="$APP_ROOT/app.staging.$$"
RECORD="$APP_ROOT/install-record.txt"
BIN_DIR="${CW_INSTALL_BIN:-$HOME/.local/bin}"
WRAPPER="$BIN_DIR/cw"
WRAPPER_MARK="# claude-workspace wrapper"

say() { printf '%s\n' "$*"; }
act() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "[dry-run] $*"
  else
    say "$*"
  fi
}

fail() {
  echo "install.sh: $*" >&2
  exit 1
}

cleanup_stage() { rm -rf "$STAGE_DIR"; }
trap cleanup_stage EXIT

# --- prerequisites ----------------------------------------------------------
command -v node > /dev/null 2>&1 || fail "node not found. Install Node.js 22+ first."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js >= 22 required (found $(node --version))."
command -v npm > /dev/null 2>&1 || fail "npm not found."
command -v git > /dev/null 2>&1 || fail "git not found. Install it with: sudo apt install git"
if ! command -v tmux > /dev/null 2>&1; then
  say "warning: tmux not found. cw needs it at runtime: sudo apt install tmux"
fi
if ! command -v claude > /dev/null 2>&1; then
  say "warning: claude (Claude Code) not found. cw works with --no-claude until it is installed."
fi

# Never overwrite an unrelated binary at the wrapper path.
if [ -e "$WRAPPER" ] && ! grep -qF "$WRAPPER_MARK" "$WRAPPER" 2> /dev/null; then
  fail "$WRAPPER exists and was not installed by claude-workspace; refusing to overwrite it."
fi

say "installing from: $REPO_DIR"
say "runtime target:  $APP_DIR"
say "executable:      $WRAPPER"
say ""

# --- build ------------------------------------------------------------------
if [ "${CW_INSTALL_SKIP_BUILD:-0}" = "1" ] && [ -f "$REPO_DIR/dist/index.js" ]; then
  act "using existing build (CW_INSTALL_SKIP_BUILD=1)"
else
  act "build: npm ci && npm run build (in $REPO_DIR)"
  if [ "$DRY_RUN" -eq 0 ]; then
    (cd "$REPO_DIR" && npm ci --no-audit --no-fund && npm run build)
  fi
fi

# --- stage a self-contained runtime ----------------------------------------
act "stage runtime in $STAGE_DIR (dist, prompts, package.json, production deps)"
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$STAGE_DIR"
  cp -R "$REPO_DIR/dist" "$STAGE_DIR/dist"
  cp -R "$REPO_DIR/prompts" "$STAGE_DIR/prompts"
  cp "$REPO_DIR/package.json" "$REPO_DIR/package-lock.json" "$STAGE_DIR/"
  (cd "$STAGE_DIR" && npm ci --omit=dev --no-audit --no-fund > /dev/null)
fi

# --- install atomically (idempotent: replaces a previous installation) ------
act "activate runtime at $APP_DIR"
if [ "$DRY_RUN" -eq 0 ]; then
  rm -rf "$APP_DIR.old"
  if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$APP_DIR.old"; fi
  mv "$STAGE_DIR" "$APP_DIR"
  rm -rf "$APP_DIR.old"
fi

act "write wrapper $WRAPPER"
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$BIN_DIR"
  cat > "$WRAPPER" << WRAP
#!/usr/bin/env bash
$WRAPPER_MARK
# Installed by claude-workspace install.sh. Safe to remove via uninstall.sh.
exec node "$APP_DIR/dist/index.js" "\$@"
WRAP
  chmod +x "$WRAPPER"
fi

act "write install record $RECORD"
if [ "$DRY_RUN" -eq 0 ]; then
  {
    echo "# files and directories owned by the claude-workspace installer"
    echo "$WRAPPER"
    echo "$APP_DIR"
    echo "$RECORD"
  } > "$RECORD"
fi

# --- verify -----------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  say ""
  say "[dry-run] nothing was changed."
  exit 0
fi

say ""
say "verifying: $WRAPPER version"
"$WRAPPER" version

say ""
say "running cw doctor (informational; warnings do not fail the installation):"
if ! "$WRAPPER" doctor; then
  say "cw doctor reported problems — see above. The installation itself succeeded."
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say ""
    say "note: $BIN_DIR is not on your PATH. Add this to your shell profile:"
    say "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

say ""
say "installed. try: cw focus demo --dry-run   (inside a Git repository)"
