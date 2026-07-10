import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type PlatformKind = 'wsl' | 'linux' | 'macos' | 'windows' | 'unknown';

export interface PlatformInfo {
  kind: PlatformKind;
  supported: boolean;
  detail: string;
}

export interface PlatformSignals {
  osPlatform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  procVersion: string;
}

export function readPlatformSignals(): PlatformSignals {
  let procVersion = '';
  try {
    procVersion = readFileSync('/proc/version', 'utf8');
  } catch {
    // Not a Linux kernel; detection falls back to os platform + env.
  }
  return { osPlatform: process.platform, env: process.env, procVersion };
}

export function detectPlatform(signals: PlatformSignals): PlatformInfo {
  if (signals.osPlatform === 'linux') {
    const isWsl =
      signals.procVersion.toLowerCase().includes('microsoft') ||
      signals.env['WSL_DISTRO_NAME'] !== undefined ||
      signals.env['WSL_INTEROP'] !== undefined;
    if (isWsl) {
      const distro = signals.env['WSL_DISTRO_NAME'];
      return {
        kind: 'wsl',
        supported: true,
        detail: distro === undefined ? 'WSL 2' : `WSL 2 (${distro})`,
      };
    }
    return { kind: 'linux', supported: true, detail: 'Linux' };
  }
  if (signals.osPlatform === 'darwin') {
    return { kind: 'macos', supported: false, detail: 'macOS is not supported in v0.1.0' };
  }
  if (signals.osPlatform === 'win32') {
    return {
      kind: 'windows',
      supported: false,
      detail: 'Native Windows is not supported; run cw inside a WSL 2 distribution',
    };
  }
  return {
    kind: 'unknown',
    supported: false,
    detail: `Unsupported platform: ${signals.osPlatform}`,
  };
}

/** True when a path sits on a Windows-mounted filesystem (e.g. /mnt/c). */
export function isWindowsMountPath(candidate: string): boolean {
  return /^\/mnt\/[a-z](\/|$)/i.test(path.posix.normalize(candidate));
}

export interface AppPaths {
  /** Workspace manifests live here. */
  stateDir: string;
  /** Installed runtime and worktrees live here. */
  dataDir: string;
  workspacesDir: string;
  worktreesRoot: string;
}

export function resolveAppPaths(
  env: Record<string, string | undefined>,
  home: string = os.homedir(),
): AppPaths {
  const stateHome = nonEmpty(env['XDG_STATE_HOME']) ?? path.join(home, '.local', 'state');
  const dataHome = nonEmpty(env['XDG_DATA_HOME']) ?? path.join(home, '.local', 'share');
  const stateDir = path.join(stateHome, 'claude-workspace');
  const dataDir = path.join(dataHome, 'claude-workspace');
  return {
    stateDir,
    dataDir,
    workspacesDir: path.join(stateDir, 'workspaces'),
    worktreesRoot: path.join(dataDir, 'worktrees'),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}
