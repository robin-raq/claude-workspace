import { describe, expect, it } from 'vitest';
import {
  claudeLaunchArgv,
  claudeVersion,
  defaultPromptsDir,
  readRolePrompt,
} from '../../src/claude.js';
import { CwError } from '../../src/errors.js';
import { rolesForMode, type RoleSpec } from '../../src/roles.js';
import type { CommandRunner } from '../../src/runner.js';

function role(mode: 'focus' | 'parallel' | 'team', id: string): RoleSpec {
  const found = rolesForMode(mode).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no role ${id}`);
  return found;
}

describe('claudeLaunchArgv', () => {
  it('starts the coordinator in plan mode', () => {
    const argv = claudeLaunchArgv({
      profile: role('focus', 'coordinator').claude!,
      systemPrompt: 'PROMPT',
      sessionName: 'cw auth coordinator',
    });
    expect(argv).toEqual([
      'claude',
      '--permission-mode',
      'plan',
      '--append-system-prompt',
      'PROMPT',
      '-n',
      'cw auth coordinator',
    ]);
  });

  it('gives the builder acceptEdits and no tool restrictions', () => {
    const argv = claudeLaunchArgv({
      profile: role('focus', 'builder').claude!,
      systemPrompt: 'PROMPT',
      sessionName: 'cw auth builder',
    });
    expect(argv).toContain('acceptEdits');
    expect(argv).not.toContain('--tools');
    expect(argv).not.toContain('--disallowedTools');
  });

  it.each(['reviewer', 'verifier'])('restricts %s to read-oriented tools', (id) => {
    const argv = claudeLaunchArgv({
      profile: role('focus', id).claude!,
      systemPrompt: 'PROMPT',
      sessionName: `cw auth ${id}`,
    });
    const toolsIndex = argv.indexOf('--tools');
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(argv[toolsIndex + 1]).toBe('Read,Grep,Glob,Bash');
    const denyIndex = argv.indexOf('--disallowedTools');
    expect(argv[denyIndex + 1]).toBe('Edit,Write,NotebookEdit');
    expect(argv).not.toContain('--permission-mode');
  });

  it('passes the team task as the initial prompt', () => {
    const argv = claudeLaunchArgv({
      profile: role('team', 'team-lead').claude!,
      systemPrompt: 'PROMPT',
      sessionName: 'cw release team-lead',
      initialPrompt: 'Ship the release checklist',
    });
    expect(argv.at(-1)).toBe('Ship the release checklist');
  });
});

describe('role prompts', () => {
  it('ships a readable prompt file for every Claude role', async () => {
    const promptsDir = defaultPromptsDir();
    const files = new Set(
      (['focus', 'parallel', 'team'] as const)
        .flatMap((mode) => rolesForMode(mode))
        .flatMap((spec) => (spec.promptFile === null ? [] : [spec.promptFile])),
    );
    expect(files).toEqual(
      new Set([
        'coordinator.md',
        'builder.md',
        'reviewer.md',
        'verifier.md',
        'track.md',
        'team-lead.md',
      ]),
    );
    for (const file of files) {
      const content = await readRolePrompt(promptsDir, file);
      expect(content).toContain('## Boundaries');
      expect(content).toContain('## Expected output');
      expect(content).toContain('## Handoff');
    }
  });

  it('never describes restrictions as a sandbox guarantee', async () => {
    const promptsDir = defaultPromptsDir();
    for (const file of ['reviewer.md', 'verifier.md']) {
      const content = await readRolePrompt(promptsDir, file);
      expect(content.replaceAll(/\s+/g, ' ')).toContain('not a security sandbox');
    }
  });

  it('raises DEPENDENCY_ERROR for a missing prompt file', async () => {
    await expect(readRolePrompt(defaultPromptsDir(), 'missing.md')).rejects.toSatisfy(
      (error: unknown) => error instanceof CwError && error.category === 'DEPENDENCY_ERROR',
    );
  });
});

describe('claudeVersion', () => {
  const stub =
    (exitCode: number, stdout: string): CommandRunner =>
    (command, args) =>
      Promise.resolve({ command, args, stdout, stderr: '', exitCode });

  it('returns the trimmed version string when claude runs', async () => {
    expect(await claudeVersion(stub(0, '2.1.206 (Claude Code)\n'))).toBe('2.1.206 (Claude Code)');
  });

  it('returns null when claude is missing or fails', async () => {
    expect(await claudeVersion(stub(127, ''))).toBeNull();
  });
});

describe('rolesForMode', () => {
  it.each(['focus', 'parallel', 'team'] as const)('%s defines exactly four roles', (mode) => {
    const roles = rolesForMode(mode);
    expect(roles).toHaveLength(4);
    expect(new Set(roles.map((spec) => spec.id)).size).toBe(4);
    expect(new Set(roles.map((spec) => spec.color)).size).toBe(4);
  });

  it('assigns the labels to the expected pane indices per mode', () => {
    expect(rolesForMode('focus').map((spec) => spec.label)).toEqual([
      'COORDINATOR',
      'BUILDER',
      'REVIEWER',
      'VERIFIER',
    ]);
    expect(rolesForMode('parallel').map((spec) => spec.label)).toEqual([
      'TRACK A',
      'TRACK B',
      'TRACK C',
      'TRACK D',
    ]);
    expect(rolesForMode('team').map((spec) => spec.label)).toEqual([
      'TEAM LEAD',
      'WORKSPACE STATUS',
      'VALIDATION',
      'GIT STATUS',
    ]);
  });

  it('matches the required color assignments', () => {
    expect(role('focus', 'coordinator').color).toBe('cyan');
    expect(role('focus', 'builder').color).toBe('green');
    expect(role('focus', 'reviewer').color).toBe('magenta');
    expect(role('focus', 'verifier').color).toBe('yellow');
    expect(role('team', 'team-lead').color).toBe('cyan');
    expect(role('team', 'git-status').color).toBe('green');
    expect(role('team', 'workspace-status').color).toBe('magenta');
    expect(role('team', 'validation').color).toBe('yellow');
  });

  it('keeps focus-mode Builder as the only writer profile', () => {
    const roles = rolesForMode('focus');
    const writers = roles.filter((spec) => spec.claude?.permissionMode === 'acceptEdits');
    expect(writers.map((spec) => spec.id)).toEqual(['builder']);
    for (const id of ['reviewer', 'verifier']) {
      expect(role('focus', id).claude?.disallowedTools).toContain('Edit');
    }
  });
});
