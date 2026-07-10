import type { Command } from 'commander';
import type { AppContext } from '../context.js';
import { runCreate } from './create.js';

interface ParallelCliOptions {
  base?: string;
  dryRun?: boolean;
  claude: boolean;
  color: boolean;
}

export function registerParallelCommand(program: Command, ctx: AppContext): void {
  program
    .command('parallel <name>')
    .summary('four isolated tracks, each in its own worktree and branch')
    .description(
      'Create a parallel workspace: four panes (Track A-D), each in its own isolated ' +
        'Git worktree on its own cw/<name>-a..d branch. Every track may edit freely ' +
        'because files and Git indexes are fully isolated.',
    )
    .option('--base <ref>', 'base ref for all four worktrees (default: HEAD)')
    .option('--dry-run', 'show everything that would be created, create nothing')
    .option('--no-claude', 'open plain shells instead of launching Claude')
    .option('--no-color', 'disable colored output and pane borders')
    .action(async (name: string, options: ParallelCliOptions) => {
      await runCreate(ctx, {
        mode: 'parallel',
        name,
        ...(options.base !== undefined ? { base: options.base } : {}),
        dryRun: options.dryRun === true,
        claude: options.claude,
        color: options.color,
      });
    });
}
