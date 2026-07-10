#!/usr/bin/env node
import process from 'node:process';
import { CommanderError } from 'commander';
import { defaultPromptsDir } from './claude.js';
import { APP_VERSION, createProgram } from './cli.js';
import type { AppContext } from './context.js';
import { CwError } from './errors.js';
import { detectPlatform, readPlatformSignals, resolveAppPaths } from './platform.js';
import { createExecaRunner } from './runner.js';

async function main(): Promise<void> {
  const env = process.env;
  const ctx: AppContext = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    runner: createExecaRunner(),
    env,
    cwd: process.cwd(),
    appVersion: APP_VERSION,
    promptsDir: defaultPromptsDir(),
    paths: resolveAppPaths(env),
    platform: detectPlatform(readPlatformSignals()),
    tmuxSocketName: env['CW_TMUX_SOCKET'],
    isTTY: process.stdout.isTTY === true,
  };
  await createProgram(ctx).parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    // commander already printed its message via configureOutput.
    process.exitCode =
      error.code === 'commander.helpDisplayed' || error.code === 'commander.version' ? 0 : 2;
    return;
  }
  if (error instanceof CwError) {
    process.stderr.write(`cw: ${error.message}\n`);
    if (error.hint !== undefined) {
      process.stderr.write(`hint: ${error.hint}\n`);
    }
    process.exitCode = error.exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cw: unexpected error: ${message}\n`);
  process.exitCode = 1;
});
