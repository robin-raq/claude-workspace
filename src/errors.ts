/**
 * Small, closed error model for cw.
 *
 * Every failure the CLI reports deliberately falls into one of six
 * categories, each with a stable nonzero exit status. Messages must be
 * actionable: say what failed, which resource was involved, and what the
 * user should do next.
 */

export type ErrorCategory =
  | 'USAGE_ERROR'
  | 'DEPENDENCY_ERROR'
  | 'GIT_ERROR'
  | 'WORKSPACE_CONFLICT'
  | 'UNSAFE_CLEANUP'
  | 'LAUNCH_ERROR';

const EXIT_CODES: Record<ErrorCategory, number> = {
  USAGE_ERROR: 2,
  DEPENDENCY_ERROR: 3,
  GIT_ERROR: 4,
  WORKSPACE_CONFLICT: 5,
  UNSAFE_CLEANUP: 6,
  LAUNCH_ERROR: 7,
};

export class CwError extends Error {
  readonly category: ErrorCategory;
  /** One-line suggestion for what the user should do next. */
  readonly hint: string | undefined;

  constructor(
    category: ErrorCategory,
    message: string,
    options: { hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CwError';
    this.category = category;
    this.hint = options.hint;
  }

  get exitCode(): number {
    return EXIT_CODES[this.category];
  }
}

export function exitCodeFor(category: ErrorCategory): number {
  return EXIT_CODES[category];
}
