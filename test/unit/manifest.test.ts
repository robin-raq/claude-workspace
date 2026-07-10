import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteManifest,
  listManifestNames,
  loadManifest,
  parseManifest,
  saveManifest,
  MANIFEST_SCHEMA_VERSION,
  type WorkspaceManifest,
} from '../../src/manifest.js';

const VALID: WorkspaceManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  appVersion: '0.1.0',
  id: 'auth-aaaaaa',
  name: 'auth',
  mode: 'focus',
  repoRoot: '/home/dev/repo',
  tmuxSession: 'cw-auth',
  baseRef: 'HEAD',
  worktreePaths: ['/data/worktrees/repo-abc/auth'],
  branches: ['cw/auth'],
  paneRoles: ['coordinator', 'builder', 'reviewer', 'verifier'],
  createdAt: '2026-07-10T00:00:00.000Z',
};

const tempDirs: string[] = [];

async function tempWorkspacesDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cw-test-manifests-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const result = parseManifest(JSON.stringify(VALID));
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON with a reason', () => {
    const result = parseManifest('{nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not valid JSON');
  });

  it('rejects unknown keys instead of silently ignoring them', () => {
    const result = parseManifest(JSON.stringify({ ...VALID, surprise: true }));
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong schema version', () => {
    const result = parseManifest(JSON.stringify({ ...VALID, schemaVersion: 99 }));
    expect(result.ok).toBe(false);
  });

  it('rejects pane role lists that are not exactly four entries', () => {
    const result = parseManifest(JSON.stringify({ ...VALID, paneRoles: ['a', 'b'] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-ISO creation timestamp', () => {
    const result = parseManifest(JSON.stringify({ ...VALID, createdAt: 'yesterday' }));
    expect(result.ok).toBe(false);
  });
});

describe('manifest store', () => {
  it('round-trips through save and load without leaving temp files', async () => {
    const dir = await tempWorkspacesDir();
    await saveManifest(dir, VALID);
    const loaded = await loadManifest(dir, 'auth');
    expect(loaded).not.toBeNull();
    expect(loaded?.ok).toBe(true);
    if (loaded?.ok) expect(loaded.manifest).toEqual(VALID);
    const files = await readdir(dir);
    expect(files).toEqual(['auth.json']);
  });

  it('returns null for a missing manifest', async () => {
    const dir = await tempWorkspacesDir();
    expect(await loadManifest(dir, 'ghost')).toBeNull();
  });

  it('lists and deletes manifests by name', async () => {
    const dir = await tempWorkspacesDir();
    await saveManifest(dir, VALID);
    await saveManifest(dir, { ...VALID, name: 'billing', id: 'billing-bbbbbb' });
    expect(await listManifestNames(dir)).toEqual(['auth', 'billing']);
    await deleteManifest(dir, 'auth');
    expect(await listManifestNames(dir)).toEqual(['billing']);
  });

  it('lists nothing when the directory does not exist yet', async () => {
    expect(await listManifestNames('/nonexistent/cw-test')).toEqual([]);
  });
});
