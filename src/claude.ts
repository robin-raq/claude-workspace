import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CwError } from './errors.js';
import type { ClaudeProfile } from './roles.js';
import type { CommandRunner } from './runner.js';

/**
 * Launch argv construction for Claude Code sessions. Uses only flags
 * verified against `claude --help` for Claude Code 2.1.206:
 * --permission-mode, --tools, --disallowedTools, --append-system-prompt, -n.
 */

/** prompts/ ships next to dist/ both in the repo and in an installation. */
export function defaultPromptsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
}

export async function readRolePrompt(promptsDir: string, file: string): Promise<string> {
  try {
    return await readFile(path.join(promptsDir, file), 'utf8');
  } catch (error) {
    throw new CwError(
      'DEPENDENCY_ERROR',
      `role prompt '${file}' was not found in '${promptsDir}'`,
      { hint: 'the prompts directory ships with cw; reinstall the application', cause: error },
    );
  }
}

export interface ClaudeLaunch {
  profile: ClaudeProfile;
  systemPrompt: string;
  /** Display name shown in the Claude session (e.g. "cw auth builder"). */
  sessionName: string;
  /** Optional initial prompt, e.g. the team task. */
  initialPrompt?: string;
}

export function claudeLaunchArgv(launch: ClaudeLaunch): string[] {
  const argv = ['claude'];
  if (launch.profile.permissionMode !== undefined) {
    argv.push('--permission-mode', launch.profile.permissionMode);
  }
  if (launch.profile.tools !== undefined && launch.profile.tools.length > 0) {
    argv.push('--tools', launch.profile.tools.join(','));
  }
  if (launch.profile.disallowedTools !== undefined && launch.profile.disallowedTools.length > 0) {
    argv.push('--disallowedTools', launch.profile.disallowedTools.join(','));
  }
  argv.push('--append-system-prompt', launch.systemPrompt);
  argv.push('-n', launch.sessionName);
  if (launch.initialPrompt !== undefined) {
    argv.push(launch.initialPrompt);
  }
  return argv;
}

/** Installed Claude Code version string, or null when unavailable. */
export async function claudeVersion(runner: CommandRunner): Promise<string | null> {
  const result = await runner('claude', ['--version']);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}
