import process from 'node:process';
import { makeTmux, type TmuxExec } from '../../src/tmux.js';
import type { CommandRunner } from '../../src/runner.js';

/**
 * Every integration test talks to a private tmux server via a unique socket
 * name, so the developer's real tmux server is never touched. Callers must
 * kill the server when done.
 */
export function makeIsolatedTmux(runner: CommandRunner): {
  tmux: TmuxExec;
  socketName: string;
  killServer: () => Promise<void>;
} {
  const socketName = `cw-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const tmux = makeTmux(runner, socketName);
  return {
    tmux,
    socketName,
    killServer: async () => {
      await tmux(['kill-server']);
    },
  };
}
