import { execa } from 'execa';

/**
 * The single injected seam of the application. Git, tmux, and Claude helpers
 * receive a CommandRunner; production uses execa (argument arrays, no shell),
 * tests use a recording fake or an execa runner scoped to temp directories.
 *
 * A runner never throws for nonzero exits or missing executables — it reports
 * them through the result so callers can raise precise, actionable CwErrors.
 */

export interface RunResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: RunOptions,
) => Promise<RunResult>;

export function createExecaRunner(baseEnv?: Record<string, string | undefined>): CommandRunner {
  return async (command, args, options = {}) => {
    const result = await execa(command, args, {
      cwd: options.cwd,
      env: { ...baseEnv, ...options.env },
      extendEnv: true,
      reject: false,
      stdin: 'ignore',
    });
    return {
      command,
      args,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      // execa reports spawn failures (e.g. executable not found) without an
      // exit code; 127 mirrors the shell convention for "command not found".
      exitCode: result.exitCode ?? 127,
    };
  };
}
