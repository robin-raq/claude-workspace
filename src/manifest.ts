import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';

export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * The manifest records only what lifecycle commands need to display, attach,
 * stop, and clean a workspace. It is the source of truth for what cw owns:
 * lifecycle commands refuse to touch resources not recorded here.
 */
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  appVersion: z.string(),
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['focus', 'parallel', 'team']),
  repoRoot: z.string().min(1),
  tmuxSession: z.string().min(1),
  baseRef: z.string().min(1),
  worktreePaths: z.array(z.string().min(1)),
  branches: z.array(z.string().min(1)),
  paneRoles: z.array(z.string().min(1)).length(4),
  createdAt: z.iso.datetime(),
});

export type WorkspaceManifest = z.infer<typeof manifestSchema>;

export type ManifestLoad =
  { ok: true; manifest: WorkspaceManifest } | { ok: false; reason: string };

export function manifestPath(workspacesDir: string, name: string): string {
  return path.join(workspacesDir, `${name}.json`);
}

export async function manifestExists(workspacesDir: string, name: string): Promise<boolean> {
  try {
    await readFile(manifestPath(workspacesDir, name), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Atomic write: temp file in the same directory, then rename. */
export async function saveManifest(
  workspacesDir: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  await mkdir(workspacesDir, { recursive: true });
  const target = manifestPath(workspacesDir, manifest.name);
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

/** Returns null when no manifest file exists for the name. */
export async function loadManifest(
  workspacesDir: string,
  name: string,
): Promise<ManifestLoad | null> {
  let raw: string;
  try {
    raw = await readFile(manifestPath(workspacesDir, name), 'utf8');
  } catch {
    return null;
  }
  return parseManifest(raw);
}

export function parseManifest(raw: string): ManifestLoad {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${(error as Error).message}` };
  }
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      reason: `does not match manifest schema v${MANIFEST_SCHEMA_VERSION}: ${issues}`,
    };
  }
  return { ok: true, manifest: parsed.data };
}

export async function listManifestNames(workspacesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(workspacesDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .sort();
}

export async function deleteManifest(workspacesDir: string, name: string): Promise<void> {
  await rm(manifestPath(workspacesDir, name), { force: true });
}
