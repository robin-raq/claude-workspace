import { createRequire } from 'node:module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;

export const UNOFFICIAL_DISCLAIMER =
  'Claude Workspace is an unofficial community project, not affiliated with or endorsed by Anthropic.';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function createProgram(io: CliIo): Command {
  const program = new Command('cw');

  program
    .description(
      'WSL-first tmux workspace manager for structured Claude Code development sessions.',
    )
    .version(APP_VERSION);

  program
    .command('version')
    .description('Print the cw version')
    .action(() => {
      io.stdout(`cw ${APP_VERSION}`);
      io.stdout(UNOFFICIAL_DISCLAIMER);
    });

  return program;
}
