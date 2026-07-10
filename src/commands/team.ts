import type { Command } from 'commander';
import type { AppContext } from '../context.js';
import { runCreate } from './create.js';

interface TeamCliOptions {
  task: string;
  base?: string;
  dryRun?: boolean;
  claude: boolean;
  color: boolean;
}

export function registerTeamCommand(program: Command, ctx: AppContext): void {
  program
    .command('team <name>')
    .summary('one Claude team lead plus live workspace, validation, and Git panes')
    .description(
      'Create a team workspace: a role-prompted Claude Team Lead working on your task ' +
        'in the original checkout, next to live workspace-status and Git-status panes and ' +
        'a validation shell. The lead is a single Claude session; native Claude ' +
        'agent-team coordination is not part of v0.1.0.',
    )
    .requiredOption('--task <text>', 'the task handed to the Team Lead (required)')
    .option('--base <ref>', 'base ref recorded for the workspace (default: HEAD)')
    .option('--dry-run', 'show everything that would be created, create nothing')
    .option('--no-claude', 'open plain shells instead of launching Claude')
    .option('--no-color', 'disable colored output and pane borders')
    .action(async (name: string, options: TeamCliOptions) => {
      await runCreate(ctx, {
        mode: 'team',
        name,
        task: options.task,
        ...(options.base !== undefined ? { base: options.base } : {}),
        dryRun: options.dryRun === true,
        claude: options.claude,
        color: options.color,
      });
    });
}
