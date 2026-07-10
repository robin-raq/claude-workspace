import type { Command } from 'commander';
import type { AppContext } from '../context.js';
import { runCreate } from './create.js';

interface FocusCliOptions {
  base?: string;
  dryRun?: boolean;
  claude: boolean;
  color: boolean;
}

export function registerFocusCommand(program: Command, ctx: AppContext): void {
  program
    .command('focus <name>')
    .summary('four-pane focus workspace: one Builder writes, three roles support')
    .description(
      'Create a focus workspace: Coordinator in the original checkout, plus Builder, ' +
        'Reviewer, and Verifier sharing one feature worktree on a new cw/<name> branch. ' +
        'The Builder is the only intended writer; Reviewer and Verifier launch with ' +
        'read-oriented tool restrictions (a workflow safeguard, not a security sandbox).',
    )
    .option('--base <ref>', 'base ref for the feature worktree (default: HEAD)')
    .option('--dry-run', 'show everything that would be created, create nothing')
    .option('--no-claude', 'open plain shells instead of launching Claude')
    .option('--no-color', 'disable colored output and pane borders')
    .action(async (name: string, options: FocusCliOptions) => {
      await runCreate(ctx, {
        mode: 'focus',
        name,
        ...(options.base !== undefined ? { base: options.base } : {}),
        dryRun: options.dryRun === true,
        claude: options.claude,
        color: options.color,
      });
    });
}
