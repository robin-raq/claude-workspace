import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerFocusCommand } from './commands/focus.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';
import { registerParallelCommand } from './commands/parallel.js';
import { registerTeamCommand } from './commands/team.js';
import type { AppContext } from './context.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;

export const UNOFFICIAL_DISCLAIMER =
  'Claude Workspace is an unofficial community project, not affiliated with or endorsed by Anthropic.';

export function createProgram(ctx: AppContext): Command {
  const program = new Command('cw');

  program
    .description(
      'WSL-first tmux workspace manager for structured Claude Code development sessions.',
    )
    .version(APP_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.stdout(text.replace(/\n$/, '')),
      writeErr: (text) => ctx.stderr(text.replace(/\n$/, '')),
    });

  registerFocusCommand(program, ctx);
  registerParallelCommand(program, ctx);
  registerTeamCommand(program, ctx);
  registerLifecycleCommands(program, ctx);
  registerDoctorCommand(program, ctx);

  program
    .command('version')
    .description('Print the cw version')
    .action(() => {
      ctx.stdout(`cw ${APP_VERSION}`);
      ctx.stdout(`platform: ${ctx.platform.detail}`);
      ctx.stdout(UNOFFICIAL_DISCLAIMER);
    });

  return program;
}
