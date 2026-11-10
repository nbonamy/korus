import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { installAcpRuntime } from '../installer';

it('preserves an invalid app command override instead of downloading a managed replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'korus-runtime-policy-'));
  vi.stubEnv('APP_HOME', root);
  vi.stubEnv('APP_ANTIGRAVITY_COMMAND', path.join(root, 'missing-command'));
  vi.stubEnv('ANTIGRAVITY_HARNESS_PATH', '');
  vi.stubEnv('SHELL', path.join(root, 'missing-shell'));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(installAcpRuntime()).rejects.toThrow('custom Antigravity runtime paths');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
