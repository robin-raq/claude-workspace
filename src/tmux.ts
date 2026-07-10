import { spawnSync } from 'node:child_process';
import { CwError } from './errors.js';
import type { RoleColor } from './roles.js';
import type { CommandRunner, RunResult } from './runner.js';

/**
 * tmux session rendering. tmux is the one unavoidable shell boundary in cw:
 * the command a pane runs is interpreted by a shell, so every argument that
 * crosses it goes through shellQuote. Everything else is argument arrays.
 */

const SAFE_ARG = /^[A-Za-z0-9_\-./:=@%+,]+$/;

/** POSIX single-quote escaping. Safe for any input, including quotes and newlines. */
export function shellQuote(arg: string): string {
  if (arg === '') return "''";
  if (SAFE_ARG.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function shellCommand(argv: readonly string[]): string {
  return argv.map(shellQuote).join(' ');
}

export type TmuxExec = (args: string[]) => Promise<RunResult>;

/**
 * All tmux calls for a workspace go through one executor. A socket name
 * isolates tests (and anything else) from the user's real tmux server.
 */
export function makeTmux(runner: CommandRunner, socketName?: string): TmuxExec {
  return (args) => runner('tmux', socketName === undefined ? args : ['-L', socketName, ...args]);
}

async function tmuxMust(t: TmuxExec, args: string[]): Promise<RunResult> {
  const result = await t(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.exitCode}`;
    throw new CwError('LAUNCH_ERROR', `tmux ${args[0]} failed: ${detail}`);
  }
  return result;
}

export async function tmuxVersion(runner: CommandRunner): Promise<string | null> {
  const result = await runner('tmux', ['-V']);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function hasSession(t: TmuxExec, session: string): Promise<boolean> {
  const result = await t(['has-session', '-t', `=${session}`]);
  return result.exitCode === 0;
}

export async function killSession(t: TmuxExec, session: string): Promise<void> {
  await tmuxMust(t, ['kill-session', '-t', `=${session}`]);
}

export interface PaneSpec {
  title: string;
  color: RoleColor;
  cwd: string;
  /** Full shell command line for the pane (already quoted by the caller). */
  command: string;
}

export interface SessionSpec {
  session: string;
  colorEnabled: boolean;
  panes: readonly [PaneSpec, PaneSpec, PaneSpec, PaneSpec];
}

/**
 * The border renders this cw-owned pane option instead of #{pane_title}:
 * programs in the pane (Claude Code updates its terminal title while it
 * works) rewrite pane_title through OSC escape sequences, which erased the
 * role labels. A @-prefixed pane option can only be changed via tmux
 * set-option, so the label survives anything the pane process prints.
 */
const PANE_TITLE_OPTION = '@cw_title';

/** Longest context (branch or path) shown in a pane title. */
const MAX_TITLE_CONTEXT = 40;

/**
 * Compose a pane title as 'LABEL · context'. Overlong contexts are shortened
 * with an ellipsis; the role label itself is never truncated.
 */
export function paneTitle(label: string, context: string): string {
  const short =
    context.length > MAX_TITLE_CONTEXT ? `${context.slice(0, MAX_TITLE_CONTEXT - 1)}…` : context;
  return `${label} · ${short}`;
}

/**
 * Per-pane border title styling. Colors vary by pane index through format
 * conditionals; the active pane gets the bright + bold variant of its role
 * color. Without color, labels stay visible and only bold marks activity.
 * Style attributes are space-separated because commas would terminate the
 * surrounding #{?,,} conditional.
 */
export function paneBorderFormat(
  colors: readonly [RoleColor, RoleColor, RoleColor, RoleColor],
  colorEnabled: boolean,
): string {
  const label = `#{${PANE_TITLE_OPTION}}`;
  if (!colorEnabled) {
    return `#{?pane_active,#[bold],} ${label} `;
  }
  const perPane = colors
    .map(
      (color, index) =>
        `#{?#{==:#{pane_index},${index}},#{?pane_active,#[fg=bright${color} bold],#[fg=${color}]},}`,
    )
    .join('');
  return `${perPane} ${label} `;
}

/**
 * Keep a failed pane command readable: remain-on-exit preserves the pane and
 * this trailer explains what happened instead of leaving a bare dead pane.
 */
export function failureVisibleCommand(command: string, label: string): string {
  const message = `\n[cw] ${label}: the pane command exited with an error. The output above explains why. This pane is kept open; detach with Ctrl-b d, or stop the workspace with 'cw stop'.`;
  return `${command} || printf '%s\\n' ${shellQuote(message)}`;
}

/** A shell pane that first prints a role banner, then hands over to $SHELL. */
export function bannerShellCommand(banner: string): string {
  return `printf '%s\\n' ${shellQuote(banner)}; exec "\${SHELL:-/bin/bash}"`;
}

/**
 * Create the detached four-pane tiled session.
 *
 * Panes are addressed by pane id (%N) captured from tmux itself, so the
 * layout is immune to base-index / pane-base-index in the user's tmux
 * configuration. Options are set per session/window only — cw never writes
 * to ~/.tmux.conf and never installs global key bindings.
 */
export async function createWorkspaceSession(t: TmuxExec, spec: SessionSpec): Promise<void> {
  const [pane0, pane1, pane2, pane3] = spec.panes;
  const window = `${spec.session}:workspace`;

  try {
    await tmuxMust(t, [
      'new-session',
      '-d',
      '-s',
      spec.session,
      '-n',
      'workspace',
      '-x',
      '220',
      '-y',
      '50',
      '-c',
      pane0.cwd,
      pane0.command,
    ]);

    const firstId = (
      await tmuxMust(t, ['list-panes', '-t', window, '-F', '#{pane_id}'])
    ).stdout.trim();
    const splitPane = async (
      orientation: '-h' | '-v',
      target: string,
      pane: PaneSpec,
    ): Promise<string> => {
      const result = await tmuxMust(t, [
        'split-window',
        '-d',
        orientation,
        '-P',
        '-F',
        '#{pane_id}',
        '-t',
        target,
        '-c',
        pane.cwd,
        pane.command,
      ]);
      return result.stdout.trim();
    };

    // Split order matters: tmux inserts a new pane's index directly after its
    // target and renumbers the rest. Creating bottom-left before top-right
    // yields final indexes 0..3 = top-left, top-right, bottom-left,
    // bottom-right, which is what the border format's per-index colors and
    // the tiled layout both assume.
    const bottomLeftId = await splitPane('-v', firstId, pane2);
    const rightId = await splitPane('-h', firstId, pane1);
    const bottomRightId = await splitPane('-h', bottomLeftId, pane3);
    const paneIds = [firstId, rightId, bottomLeftId, bottomRightId];

    await tmuxMust(t, ['set-option', '-t', spec.session, 'mouse', 'on']);
    await tmuxMust(t, ['set-option', '-t', spec.session, 'focus-events', 'on']);
    await tmuxMust(t, ['set-option', '-t', spec.session, 'history-limit', '50000']);
    await tmuxMust(t, ['set-option', '-w', '-t', window, 'pane-border-status', 'top']);
    await tmuxMust(t, [
      'set-option',
      '-w',
      '-t',
      window,
      'pane-border-format',
      paneBorderFormat([pane0.color, pane1.color, pane2.color, pane3.color], spec.colorEnabled),
    ]);
    await tmuxMust(t, ['set-option', '-w', '-t', window, 'remain-on-exit', 'on']);
    await tmuxMust(t, ['set-option', '-w', '-t', window, 'pane-active-border-style', 'bold']);

    for (const [index, pane] of spec.panes.entries()) {
      const paneId = paneIds[index] as string;
      // The border reads @cw_title (see PANE_TITLE_OPTION); pane_title is
      // still set for anything else that displays it, but nothing cw renders
      // depends on it staying intact.
      await tmuxMust(t, ['set-option', '-p', '-t', paneId, PANE_TITLE_OPTION, pane.title]);
      await tmuxMust(t, ['select-pane', '-t', paneId, '-T', pane.title]);
    }
    await tmuxMust(t, ['select-layout', '-t', window, 'tiled']);
    await tmuxMust(t, ['select-pane', '-t', firstId]);
  } catch (error) {
    // Leave no half-built session behind; the caller reports the failure.
    await t(['kill-session', '-t', `=${spec.session}`]);
    throw error;
  }
}

/**
 * Attach the current terminal to a session. This is the one place cw hands
 * the terminal over to tmux, so it uses inherited stdio instead of the
 * capturing runner. Returns the tmux exit status.
 */
export function attachSessionInteractive(session: string, socketName?: string): number {
  const args =
    socketName === undefined
      ? ['attach-session', '-t', `=${session}`]
      : ['-L', socketName, 'attach-session', '-t', `=${session}`];
  const result = spawnSync('tmux', args, { stdio: 'inherit' });
  return result.status ?? 1;
}

export async function listPaneTitles(t: TmuxExec, session: string): Promise<string[]> {
  const result = await tmuxMust(t, [
    'list-panes',
    '-t',
    `${session}:workspace`,
    '-F',
    '#{pane_title}',
  ]);
  return result.stdout.trim().split('\n');
}

/** The cw-owned role labels per pane, in pane-index order. */
export async function listPaneLabels(t: TmuxExec, session: string): Promise<string[]> {
  const result = await tmuxMust(t, [
    'list-panes',
    '-t',
    `${session}:workspace`,
    '-F',
    `#{${PANE_TITLE_OPTION}}`,
  ]);
  return result.stdout.trim().split('\n');
}
