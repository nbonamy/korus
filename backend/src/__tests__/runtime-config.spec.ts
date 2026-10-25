import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('backend runtime config', () => {
  it('retains all release application IDs in the executable package without runtime environment configuration', async () => {
    const providers = ['GITHUB', 'GITLAB', 'LINEAR'] as const;
    for (const provider of providers) vi.stubEnv(`APP_${provider}_CLIENT_ID`, `release-${provider.toLowerCase()}`);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'korus-packaged-config-'));
    try {
      const result = await build({
        configFile: path.resolve(import.meta.dirname, '../../vite.config.ts'),
        logLevel: 'silent',
        build: { ssr: path.resolve(import.meta.dirname, '../runtime-config.ts'), write: false, sourcemap: false },
      });
      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one executable package.');
      const entry = result.output.find(output => output.type === 'chunk' && output.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('Packaged runtime configuration is missing.');
      const file = path.join(directory, 'runtime.mjs');
      await writeFile(file, entry.code);
      const env = { ...process.env };
      for (const provider of providers) delete env[`APP_${provider}_CLIENT_ID`];
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
        `const config = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify({ github: config.runtimeGitHubOAuthClientId(), gitlab: config.runtimeGitLabOAuthClientId(), linear: config.runtimeLinearOAuthSettings().oauthClientId }));`,
      ], { env });
      expect(JSON.parse(stdout)).toStrictEqual({ github: 'release-github', gitlab: 'release-gitlab', linear: 'release-linear' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resolves the GitLab public client ID independently from settings, environment and build defaults', async () => {
    vi.stubGlobal('__APP_GITLAB_CLIENT_ID__', 'packaged-gitlab');
    vi.stubEnv('APP_GITLAB_CLIENT_ID', undefined);
    const { runtimeGitLabOAuthClientId } = await import('../runtime-config');
    expect(runtimeGitLabOAuthClientId()).toBe('packaged-gitlab');
    vi.stubEnv('APP_GITLAB_CLIENT_ID', ' env-gitlab ');
    expect(runtimeGitLabOAuthClientId()).toBe('env-gitlab');
    expect(runtimeGitLabOAuthClientId({ oauthClientId: ' saved-gitlab ' })).toBe('saved-gitlab');
    expect(runtimeGitLabOAuthClientId({ oauthClientId: ' ' })).toBe('env-gitlab');
  });

  it('uses the app client ID when saved Linear settings are blank', async () => {
    vi.stubEnv('APP_LINEAR_CLIENT_ID', ' app-client ');
    const { runtimeLinearOAuthSettings } = await import('../runtime-config');
    const expected = { oauthClientId: 'app-client' };
    expect(runtimeLinearOAuthSettings()).toEqual(expected);
    expect(runtimeLinearOAuthSettings({ oauthClientId: ' ' })).toEqual(expected);
  });

  it('resolves public Linear OAuth configuration from packaged defaults, environment, then settings', async () => {
    vi.stubGlobal('__APP_LINEAR_CLIENT_ID__', 'packaged-client');
    vi.stubEnv('APP_LINEAR_CLIENT_ID', undefined);
    const { runtimeLinearOAuthSettings } = await import('../runtime-config');
    expect(runtimeLinearOAuthSettings()).toEqual({ oauthClientId: 'packaged-client' });
    vi.stubEnv('APP_LINEAR_CLIENT_ID', ' env-client ');
    expect(runtimeLinearOAuthSettings()).toEqual({ oauthClientId: 'env-client' });
    expect(runtimeLinearOAuthSettings({ oauthClientId: 'settings-client' })).toEqual({ oauthClientId: 'settings-client' });
  });

  it('uses the GitHub OAuth client ID from settings before environment or packaged defaults', async () => {
    const { runtimeGitHubOAuthClientId } = await import('../runtime-config');

    expect(runtimeGitHubOAuthClientId(
      { oauthClientId: ' settings-client-id ' },
      { environmentClientId: ' env-client-id ', packagedClientId: ' packaged-client-id ' },
    )).toBe('settings-client-id');
  });

  it('uses the GitHub OAuth client ID from environment before packaged defaults', async () => {
    const { runtimeGitHubOAuthClientId } = await import('../runtime-config');

    expect(runtimeGitHubOAuthClientId(undefined, {
      environmentClientId: ' env-client-id ', packagedClientId: ' packaged-client-id ',
    })).toBe('env-client-id');
  });

  it('uses the packaged GitHub OAuth client ID fallback when environment is absent', async () => {
    const { runtimeGitHubOAuthClientId } = await import('../runtime-config');

    expect(runtimeGitHubOAuthClientId(undefined, {
      environmentClientId: null, packagedClientId: ' packaged-client-id ',
    })).toBe('packaged-client-id');
  });

  it('returns an empty GitHub OAuth client ID when no runtime source is configured', async () => {
    const { runtimeGitHubOAuthClientId } = await import('../runtime-config');

    expect(runtimeGitHubOAuthClientId(undefined, {
      environmentClientId: null, packagedClientId: null,
    })).toBe('');
  });
});
