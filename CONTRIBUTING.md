# Contributing

Thanks for considering a contribution. This project values small, safe,
well-tested changes over broad ones.

## Getting set up (WSL 2 / Linux)

```bash
sudo apt install tmux shellcheck   # runtime + script linting
git clone <your fork>
cd claude-workspace
npm ci                             # exact, lockfile-pinned dependencies
npm run check                      # format, lint, typecheck, tests+coverage, build
npm run build                      # compile to dist/ only
```

If `npm run check` passes on a fresh clone, your environment is good.

For a development `cw` on your PATH, use `npm link` (uninstall with
`npm unlink -g claude-workspace`). The public installer
(`./scripts/install.sh`) is the supported end-user path; try your changes
through it at least once before opening a PR that touches installation.

## Running tests

```bash
npm run test:unit          # fast, pure-logic tests
npm run test:integration   # real temp repos, real worktrees, isolated tmux
npm test                   # both
npm run test:coverage      # both, with V8 coverage
```

Integration tests are designed to be safe to run on your machine:

- tmux tests run on **isolated sockets** (`tmux -L cw-test-*`), never your
  real tmux server.
- Git tests use temporary repositories and worktrees under temp
  directories.
- Installer tests run against a **temporary HOME**, never your real
  `~/.local`.
- A fake `claude` executable is placed on `PATH`; tests never touch your
  real Claude settings or the Claude API.

If a crashed run leaves `cw-test-*` sockets in `/tmp/tmux-$(id -u)/`, they
are harmless; kill one with `tmux -L <name> kill-server` or reboot.

### Testing installer changes by hand

Point the installer at a throwaway HOME so your real environment is never
involved:

```bash
TMP_HOME="$(mktemp -d)"
HOME="$TMP_HOME" ./scripts/install.sh --dry-run
HOME="$TMP_HOME" ./scripts/install.sh
HOME="$TMP_HOME" "$TMP_HOME/.local/bin/cw" version
HOME="$TMP_HOME" ./scripts/uninstall.sh
rm -rf "$TMP_HOME"
```

## Ground rules

- **`npm run check` must pass.** CI runs the same gate on Node 22 and 24,
  plus `shellcheck scripts/*.sh`.
- **Safety behavior needs tests.** Anything touching cleanup, rollback,
  containment, worktree ownership, or shell quoting must come with unit or
  integration coverage.
- **Keep the scope small.** v0.1.0 is deliberately minimal: no new
  commands, flags, or configuration surface without a roadmap discussion in
  an issue first. See the README's
  [Limitations and roadmap](README.md#limitations-and-roadmap) for what is
  intentionally out of scope.
- **Match the existing style.** Strict TypeScript, ESM, argument-array
  process execution (no `shell: true`), actionable error messages in the
  six existing error categories (`src/errors.ts`).
- **Documentation follows behavior.** If a change alters what a command
  does, prints, or refuses, update the README and `docs/` in the same PR.
- Coverage (~85%+) is a quality target, not a game: no tests of private
  implementation details just to move the number.

## Supply-chain policy

GitHub Actions are pinned to major version tags and run with least-privilege
permissions (`contents: read`). Dependencies are kept to the minimal
justified set (commander, zod, execa at runtime); adding one requires a
clear rationale in the PR description.

## Commits and pull requests

- Conventional prefixes: `feat:`, `fix:`, `docs:`, `build:`, `test:`,
  `chore:`. One coherent change per commit.
- A PR should state what changed, why, and how it was verified (which
  tests, which manual workflows).
- Small, reviewable PRs merge fastest; unrelated cleanups belong in their
  own PR.
