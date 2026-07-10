#!/usr/bin/env node
import process from 'node:process';
import { createProgram } from './cli.js';
import { CwError } from './errors.js';

async function main(): Promise<void> {
  const program = createProgram({
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  });
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
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
