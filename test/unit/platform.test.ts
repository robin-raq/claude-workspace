import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  isWindowsMountPath,
  readPlatformSignals,
  resolveAppPaths,
  type PlatformSignals,
} from '../../src/platform.js';

function signals(overrides: Partial<PlatformSignals>): PlatformSignals {
  return { osPlatform: 'linux', env: {}, procVersion: '', ...overrides };
}

describe('detectPlatform', () => {
  it('detects WSL from /proc/version', () => {
    const info = detectPlatform(
      signals({ procVersion: 'Linux version 6.18.33.2-microsoft-standard-WSL2' }),
    );
    expect(info.kind).toBe('wsl');
    expect(info.supported).toBe(true);
  });

  it('detects WSL from environment variables and reports the distro', () => {
    const info = detectPlatform(signals({ env: { WSL_DISTRO_NAME: 'Ubuntu' } }));
    expect(info.kind).toBe('wsl');
    expect(info.detail).toContain('Ubuntu');
  });

  it('detects plain Linux', () => {
    const info = detectPlatform(signals({ procVersion: 'Linux version 6.8.0-generic' }));
    expect(info.kind).toBe('linux');
    expect(info.supported).toBe(true);
  });

  it('reports macOS as unsupported in v0.1.0', () => {
    const info = detectPlatform(signals({ osPlatform: 'darwin' }));
    expect(info.kind).toBe('macos');
    expect(info.supported).toBe(false);
  });

  it('reports native Windows as unsupported with WSL guidance', () => {
    const info = detectPlatform(signals({ osPlatform: 'win32' }));
    expect(info.kind).toBe('windows');
    expect(info.supported).toBe(false);
    expect(info.detail).toContain('WSL');
  });

  it('reports any other platform as unsupported', () => {
    const info = detectPlatform(signals({ osPlatform: 'freebsd' }));
    expect(info.kind).toBe('unknown');
    expect(info.supported).toBe(false);
  });
});

describe('readPlatformSignals', () => {
  it('gathers live signals that the detector accepts', () => {
    const live = readPlatformSignals();
    expect(typeof live.procVersion).toBe('string');
    // This test suite runs on Linux/WSL in development and CI.
    expect(detectPlatform(live).supported).toBe(true);
  });
});

describe('isWindowsMountPath', () => {
  it.each(['/mnt/c/Users/dev/repo', '/mnt/d', '/mnt/C/x'])('flags %s', (p) => {
    expect(isWindowsMountPath(p)).toBe(true);
  });

  it.each(['/home/dev/repo', '/mnt/wsl/something', '/mntc/evil', '/data/mnt/c'])(
    'does not flag %s',
    (p) => {
      expect(isWindowsMountPath(p)).toBe(false);
    },
  );
});

describe('resolveAppPaths', () => {
  it('uses XDG defaults under HOME', () => {
    const paths = resolveAppPaths({}, '/home/dev');
    expect(paths.stateDir).toBe('/home/dev/.local/state/claude-workspace');
    expect(paths.dataDir).toBe('/home/dev/.local/share/claude-workspace');
    expect(paths.workspacesDir).toBe('/home/dev/.local/state/claude-workspace/workspaces');
    expect(paths.worktreesRoot).toBe('/home/dev/.local/share/claude-workspace/worktrees');
  });

  it('honors XDG environment overrides', () => {
    const paths = resolveAppPaths(
      { XDG_STATE_HOME: '/custom/state', XDG_DATA_HOME: '/custom/data' },
      '/home/dev',
    );
    expect(paths.stateDir).toBe('/custom/state/claude-workspace');
    expect(paths.worktreesRoot).toBe('/custom/data/claude-workspace/worktrees');
  });

  it('ignores empty XDG overrides', () => {
    const paths = resolveAppPaths({ XDG_STATE_HOME: '  ' }, '/home/dev');
    expect(paths.stateDir).toBe('/home/dev/.local/state/claude-workspace');
  });
});
