import { describe, expect, it } from 'vitest';

type ReleaseNotesScript = {
  assertReleaseNotesCurrent: (actual: string, expected: string) => void;
  assertVersionConsistency: (input: {
    rootPackage: { version?: string };
    workspaces: Array<{ path: string; manifest: { version?: string; dependencies?: Record<string, string> } }>;
    lockfile: { version?: string; packages?: Record<string, { version?: string; dependencies?: Record<string, string> }> };
  }) => string;
  createReleaseNotes: (input: { version: string; changelog: string }) => {
    schemaVersion: number;
    currentVersion: string;
    releases: Array<{
      version: string;
      releasedAt: string;
      sourceSha256: string;
      markdown: string;
    }>;
  };
};

async function loadScript(): Promise<ReleaseNotesScript> {
  // @ts-expect-error release-notes.mjs is an executable Node script with testable exports.
  return await import('../../../../../scripts/release-notes.mjs') as ReleaseNotesScript;
}

describe('release-notes script', () => {
  it('keeps release content and hashes stable across Windows checkout line endings', async () => {
    const { createReleaseNotes, assertReleaseNotesCurrent } = await loadScript();
    const changelog = '## [1.2.3] - 2026-10-06\n\n### Fixes\n\n- Fixed startup.\n';
    const notes = createReleaseNotes({ version: '1.2.3', changelog });
    expect(createReleaseNotes({ version: '1.2.3', changelog: changelog.replaceAll('\n', '\r\n') })).toStrictEqual(notes);
    const serialized = JSON.stringify(notes, null, 2) + '\n';
    expect(() => assertReleaseNotesCurrent(serialized.replaceAll('\n', '\r\n'), serialized)).not.toThrow();
  });
  it('freezes the current version and complete released changelog history', async () => {
    const { createReleaseNotes } = await loadScript();
    const notes = createReleaseNotes({
      version: '0.5.0',
      changelog: [
        '# Changelog',
        '',
        '## Unreleased',
        '',
        '## [0.5.0] - 2026-08-04',
        '',
        '### New features',
        '',
        '- Added What’s New.',
        '',
        '## [0.4.0] - 2026-08-03',
        '',
        '- Previous release.',
      ].join('\n'),
    });

    expect(notes).toStrictEqual({
      schemaVersion: 2,
      currentVersion: '0.5.0',
      releases: [
        {
          version: '0.5.0',
          releasedAt: '2026-08-04',
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          markdown: '### New features\n\n- Added What’s New.',
        },
        {
          version: '0.4.0',
          releasedAt: '2026-08-03',
          sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          markdown: '- Previous release.',
        },
      ],
    });
  });

  it('rejects a changelog without the package release section', async () => {
    const { assertReleaseNotesCurrent, createReleaseNotes } = await loadScript();
    expect(() => createReleaseNotes({
      version: '0.5.0',
      changelog: '## [0.4.0] - 2026-08-03\n\n- Previous release.',
    })).toThrow('CHANGELOG.md must contain a release heading for 0.5.0');
    expect(() => assertReleaseNotesCurrent('{"version":"0.4.0"}', '{"version":"0.5.0"}'))
      .toThrow('release-notes.json is stale');
  });

  it('rejects workspace and lockfile version drift', async () => {
    const { assertVersionConsistency } = await loadScript();
    const consistentInput = {
      rootPackage: { version: '0.5.0' },
      workspaces: [{
        path: 'client/electron/package.json',
        manifest: { version: '0.5.0', dependencies: { '@workspace/core': '0.5.0' } },
      }],
      lockfile: {
        version: '0.5.0',
        packages: {
          '': { version: '0.5.0' },
          'client/electron': { version: '0.5.0', dependencies: { '@workspace/core': '0.5.0' } },
        },
      },
    };

    expect(assertVersionConsistency(consistentInput)).toBe('0.5.0');
    expect(() => assertVersionConsistency({
      ...consistentInput,
      workspaces: [{ path: 'client/electron/package.json', manifest: { version: '0.4.0' } }],
    })).toThrow('client/electron/package.json version 0.4.0 does not match root version 0.5.0');
    expect(() => assertVersionConsistency({
      ...consistentInput,
      lockfile: { ...consistentInput.lockfile, version: '0.4.0' },
    })).toThrow('package-lock.json root version does not match 0.5.0');
  });
});
