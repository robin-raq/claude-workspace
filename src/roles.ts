import type { Mode } from './workspace.js';

export type RoleColor = 'cyan' | 'green' | 'magenta' | 'yellow';

export interface ClaudeProfile {
  permissionMode?: 'plan' | 'acceptEdits';
  /** Restrict the built-in tool set (e.g. read-oriented roles). */
  tools?: readonly string[];
  /** Explicitly denied tools, layered on top of the tool set. */
  disallowedTools?: readonly string[];
}

export type PaneKind = 'claude' | 'workspace-status' | 'validation' | 'git-status';

export interface RoleSpec {
  id: string;
  label: string;
  color: RoleColor;
  /** 'repo' = the original checkout; a number indexes into plan.worktrees. */
  workdir: 'repo' | number;
  kind: PaneKind;
  /** Prompt file under prompts/ for Claude panes. */
  promptFile: string | null;
  claude: ClaudeProfile | null;
}

/**
 * Read-oriented restriction for Reviewer and Verifier. This is a workflow
 * safeguard that keeps those panes from editing files by default — it is
 * NOT a security sandbox and is not described as one anywhere.
 */
const READ_ORIENTED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const;
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const;

const FOCUS_ROLES: readonly RoleSpec[] = [
  {
    id: 'coordinator',
    label: 'COORDINATOR',
    color: 'cyan',
    workdir: 'repo',
    kind: 'claude',
    promptFile: 'coordinator.md',
    claude: { permissionMode: 'plan' },
  },
  {
    id: 'builder',
    label: 'BUILDER',
    color: 'green',
    workdir: 0,
    kind: 'claude',
    promptFile: 'builder.md',
    claude: { permissionMode: 'acceptEdits' },
  },
  {
    id: 'reviewer',
    label: 'REVIEWER',
    color: 'magenta',
    workdir: 0,
    kind: 'claude',
    promptFile: 'reviewer.md',
    claude: { tools: READ_ORIENTED_TOOLS, disallowedTools: EDIT_TOOLS },
  },
  {
    id: 'verifier',
    label: 'VERIFIER',
    color: 'yellow',
    workdir: 0,
    kind: 'claude',
    promptFile: 'verifier.md',
    claude: { tools: READ_ORIENTED_TOOLS, disallowedTools: EDIT_TOOLS },
  },
];

const PARALLEL_ROLES: readonly RoleSpec[] = (
  [
    ['track-a', 'TRACK A', 'cyan', 0],
    ['track-b', 'TRACK B', 'green', 1],
    ['track-c', 'TRACK C', 'magenta', 2],
    ['track-d', 'TRACK D', 'yellow', 3],
  ] as const
).map(([id, label, color, workdir]) => ({
  id,
  label,
  color,
  workdir,
  kind: 'claude' as const,
  promptFile: 'track.md',
  claude: {},
}));

const TEAM_ROLES: readonly RoleSpec[] = [
  {
    id: 'team-lead',
    label: 'TEAM LEAD',
    color: 'cyan',
    workdir: 'repo',
    kind: 'claude',
    promptFile: 'team-lead.md',
    claude: {},
  },
  {
    id: 'workspace-status',
    label: 'WORKSPACE STATUS',
    color: 'magenta',
    workdir: 'repo',
    kind: 'workspace-status',
    promptFile: null,
    claude: null,
  },
  {
    id: 'validation',
    label: 'VALIDATION',
    color: 'yellow',
    workdir: 'repo',
    kind: 'validation',
    promptFile: null,
    claude: null,
  },
  {
    id: 'git-status',
    label: 'GIT STATUS',
    color: 'green',
    workdir: 'repo',
    kind: 'git-status',
    promptFile: null,
    claude: null,
  },
];

export function rolesForMode(mode: Mode): readonly RoleSpec[] {
  switch (mode) {
    case 'focus':
      return FOCUS_ROLES;
    case 'parallel':
      return PARALLEL_ROLES;
    case 'team':
      return TEAM_ROLES;
  }
}
