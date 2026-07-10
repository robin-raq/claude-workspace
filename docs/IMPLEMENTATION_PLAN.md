# Implementation Plan — v0.1.0

Approved plan for the focused v0.1.0 release, including the four binding
amendments accepted at approval time. Work happens locally on `build/v0.1.0`
in focused commits; nothing is pushed, tagged, released, or mirrored to any
remote until explicitly approved.

## Scope

Commands: `cw focus <name>`, `cw parallel <name>`, `cw team <name> --task "<task>"`,
`cw list`, `cw attach <name>`, `cw stop <name>`, `cw clean <name>`, `cw doctor`,
`cw version`.

Creation flags — only: `--dry-run`, `--no-claude`, `--no-color`, `--base <ref>`;
team additionally requires `--task <text>`. No lifecycle overrides
(`--force`, `--delete-dirty`, `--delete-unmerged`, `--allow-dirty-base`,
`--watch`) exist in v0.1.0. A dirty source checkout fails creation with an
actionable message. Deferred features are recorded in the README roadmap, not
implemented.

## Phases and gates

Each phase ends with focused local commits and must pass its gate before the
next phase starts.

1. **Scaffold + minimal docs** — strict TypeScript/ESM project, ESLint,
   Prettier, Vitest (unit + integration projects, v8 coverage), npm scripts
   (`format`, `format:check`, `lint`, `typecheck`, `test`, `test:unit`,
   `test:integration`, `test:coverage`, `build`, `check`), minimal
   least-privilege CI workflow, `docs/ARCHITECTURE.md`, this plan, working
   `cw version`. _Gate:_ `npm run check` green.
2. **Git worktrees + manifests** — platform/WSL/XDG, name validation and path
   containment, `git.ts`, `manifest.ts` (atomic writes), `workspace.ts`
   plan/execute with reverse-order rollback. _Gate:_ unit tests for names,
   traversal, WSL detection, XDG, manifests; integration tests on real temp
   repositories for creation, dirty-base refusal, collision refusal, rollback
   after injected failure.
3. **tmux + Claude launch** — tiled four-pane layout, role colors and labels,
   remain-on-exit failure visibility, `shellQuote`, per-role Claude argv, role
   prompt files. _Gate:_ unit tests for escaping (hostile input), argv per
   role, color/no-color; integration test creating a real four-pane session on
   an isolated tmux socket with a fake `claude`.
4. **Mode commands** — `focus`, `parallel`, `team` with
   `--dry-run/--no-claude/--no-color/--base` (+ required `--task`). _Gate:_
   plan snapshot tests; integration tests for focus shared-worktree behavior,
   parallel isolation, team pane content, and dry-run causing zero Git or
   filesystem mutation.
5. **Lifecycle + installer + full tests** — `list`, `attach`, `stop`, `clean`,
   `doctor`; self-contained installer and uninstaller; remaining test matrix
   including temporary-HOME install/uninstall. _Gate:_ full suite and coverage
   green; `shellcheck scripts/*.sh` clean.
6. **README + demo docs + final verification** — README (with roadmap and
   unofficial-project disclaimer), LICENSE, CONTRIBUTING, SECURITY, CHANGELOG,
   docs/DEMO.md, docs/TROUBLESHOOTING.md; end-to-end verification: installer
   dry-run, temp-HOME install, `cw doctor`, dry-runs of all three modes, a
   real `cw focus --no-claude` on a scratch repository with an isolated tmux
   socket, `cw stop`/`cw clean`, uninstall, full diff review, completion
   report.

## Binding amendments (approved)

### 1. `cw clean` preflights before stopping the session

Order of operations:

1. Load and validate the workspace manifest.
2. Verify every recorded worktree path is application-owned and contained
   beneath the configured application worktree root.
3. Inspect every recorded worktree for uncommitted changes.
4. If any worktree is dirty, return `UNSAFE_CLEANUP` **without stopping the
   tmux session or modifying any resource**.
5. Stop the application-owned tmux session if it is running.
6. Remove only the clean, manifest-recorded worktrees.
7. Remove the manifest.
8. Print all preserved branch names and optional manual `git branch -d`
   commands.

`cw clean` never terminates an active workspace before establishing that
cleanup can safely complete. Branches are always preserved.

### 2. Self-contained installation

The installed `cw` must not depend on the original clone remaining at the same
path. `install.sh` builds and copies the runtime into a stable
application-owned location:

```text
~/.local/share/claude-workspace/app/
├── dist/
├── prompts/
├── package.json
└── node_modules/   (production dependencies only)
```

`~/.local/bin/cw` is a wrapper or symlink pointing at that installed runtime.
An installation record lists exactly what the installer owns. `uninstall.sh`
removes only the wrapper/executable, the installed runtime directory, and the
installation record — workspace manifests, Git worktrees, and user-created
branches are preserved and remain under explicit `cw clean` lifecycle
management. `npm link` remains a documented development-only path.

### 3. Real ShellCheck

Shell scripts are checked with the real `shellcheck` executable
(`shellcheck scripts/*.sh`), not `npx`. ShellCheck is a development and CI
dependency, not a runtime dependency of `cw`. WSL development prerequisite:

```bash
sudo apt install shellcheck
```

CI installs it with `apt-get` before running it.

### 4. Coverage is a quality target

Approximately 85% coverage is a target, not a number to satisfy with brittle
tests. No tests of private implementation details or low-value padding. The
deepest coverage belongs to: path containment, dirty-worktree cleanup refusal,
worktree ownership, focus shared-worktree behavior, parallel isolation,
dry-run non-mutation, manifest validation, shell argument escaping, and
partial-failure rollback.

## Verified environment assumptions

Developed and verified on WSL2 (Ubuntu): Git 2.53, Node 24 (engine floor 22),
tmux 3.6, Claude Code 2.1.206. Claude flags used by `cw`
(`--permission-mode`, `--tools`, `--disallowedTools`, `--append-system-prompt`,
`-n/--name`) were verified against `claude --help` for that version. Claude
Code 2.1.206 exposes no agent-team CLI interface; team mode therefore makes no
native-team claims, and native integration is a roadmap item only.
