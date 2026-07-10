import type { AppPaths, PlatformInfo } from './platform.js';
import type { CommandRunner } from './runner.js';

/**
 * Everything a command needs from the outside world, built once in index.ts
 * for production and assembled with temp directories, isolated tmux sockets,
 * and fake executables in tests.
 */
export interface AppContext {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  runner: CommandRunner;
  env: Record<string, string | undefined>;
  cwd: string;
  appVersion: string;
  promptsDir: string;
  paths: AppPaths;
  platform: PlatformInfo;
  /** Private tmux socket name; set via CW_TMUX_SOCKET (tests, smoke runs). */
  tmuxSocketName: string | undefined;
  /** True when stdout is an interactive terminal (enables auto-attach). */
  isTTY: boolean;
}
