# Contributing

Thanks for considering a contribution. This project values small, safe,
well-tested changes over broad ones.

## Development setup (WSL 2 / Linux)

```bash
sudo apt install tmux shellcheck   # runtime + script linting
git clone <your fork>
cd claude-workspace
npm install
npm run check                      # format, lint, typecheck, tests+coverage, build
```

`npm link` gives you a development `cw` on your PATH. The public installer
(`./scripts/install.sh`) is the supported end-user path.

## Ground rules

- **`npm run check` must pass.** CI runs the same gate on Node 22 and 24,
  plus `shellcheck scripts/*.sh`.
- **Safety behavior needs tests.** Anything touching cleanup, rollback,
  containment, worktree ownership, or shell quoting must come with unit or
  integration coverage. Integration tests must stay isolated: temp
  repositories, temp HOME, isolated tmux sockets (`tmux -L`), never the
  developer's real environment, and never the Claude API.
- **Keep the scope small.** v0.1.0 is deliberately minimal; new surface area
  (flags, commands, configuration) should start as a roadmap discussion in
  an issue, not a PR.
- **Match the existing style.** Strict TypeScript, ESM, argument-array
  process execution (no `shell: true`), actionable error messages in the six
  existing error categories.
- Coverage (~85%) is a quality target, not a game: no tests of private
  implementation details just to move the number.

## Supply-chain policy

GitHub Actions are pinned to major version tags and run with least-privilege
permissions (`contents: read`). Dependencies are kept to the minimal
justified set (commander, zod, execa at runtime); adding one requires a
clear rationale in the PR description.

## Commit style

Conventional prefixes: `feat:`, `fix:`, `docs:`, `build:`, `test:`,
`chore:`. One coherent change per commit.
