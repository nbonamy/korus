import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import product from '../../../core/src/product.json' with { type: 'json' };
import {
  agentRecovery,
  parseRecoveryArguments,
  stateWithRecoveredThread,
} from './recover-compressed-session.mjs';

it('parses a dry-run recovery command', () => {
  const parsed = parseRecoveryArguments(['/tmp/backup.tar', '/tmp/repo', '--dry-run']);
  expect(parsed).toEqual({
    backupPath: '/tmp/backup.tar',
    agentFolder: '/tmp/repo',
    dryRun: true,
  });
});

it('recovers only the matching Codex agent thread', () => {
  const currentState = state('thread-broken');
  currentState.agents.push({ id: 'untouched', provider: 'claude', folder: '/tmp/other' });
  const backupState = state('thread-recovered');

  const recovery = agentRecovery(currentState, backupState, '/tmp/repo');
  expect(recovery.currentThreadId).toBe('thread-broken');
  expect(recovery.recoveredThreadId).toBe('thread-recovered');

  const nextState = stateWithRecoveredThread(
    currentState,
    recovery.currentAgent.id,
    recovery.recoveredThreadId,
    '2026-09-07T12:00:00.000Z',
  );
  expect(nextState.agents[0]).toEqual({
    ...currentState.agents[0],
    providerSession: { kind: 'codex', threadId: 'thread-recovered' },
    updatedAt: '2026-09-07T12:00:00.000Z',
  });
  expect(nextState.agents[1]).toBe(currentState.agents[1]);
});

it('recovers a thread in the roster layout and still reads a backup of the older state file', () => {
  const current = roster('thread-broken');
  const recovery = agentRecovery(current, state('thread-recovered'), '/tmp/repo');
  expect(recovery.currentThreadId).toBe('thread-broken');
  expect(recovery.recoveredThreadId).toBe('thread-recovered');

  const next = stateWithRecoveredThread(current, recovery.currentAgent.id, recovery.recoveredThreadId, '2026-10-03T12:00:00.000Z');
  expect(next.data.agents[0]).toEqual({
    ...current.data.agents[0],
    engine: { kind: 'codex', session: { threadId: 'thread-recovered' } },
    updatedAt: '2026-10-03T12:00:00.000Z',
  });
  expect(next.schemaVersion).toBe(1);
});

it('rejects an ambiguous folder instead of changing multiple agents', () => {
  const currentState = state('thread-current');
  currentState.agents.push({ ...currentState.agents[0], id: 'agent-2' });
  expect(() => agentRecovery(currentState, state('thread-backup'), '/tmp/repo'))
    .toThrow(/Expected exactly one Codex agent.*found 2/);
});

// Creates a real archive and launches the installed recovery command and process guard.
it.skipIf(process.platform === 'win32').each([
  `/Applications/${product.name}.app/Contents/MacOS/${product.name}`,
  `/usr/local/bin/node /Applications/${product.name}.app/Contents/Resources/daemon/daemon.mjs serve`,
])('refuses recovery without writing state while a packaged process is active: %s', async (command) => {
  const root = await mkdtemp(path.join(tmpdir(), 'session-recovery-'));
  try {
    const stateDirectory = path.join(root, 'current');
    const archiveDirectory = path.join(root, 'archive');
    const archiveHome = path.join(archiveDirectory, product.homeDirectory);
    const bin = path.join(root, 'bin');
    await Promise.all([stateDirectory, archiveHome, bin].map((folder) => mkdir(folder, { recursive: true })));
    const statePath = path.join(stateDirectory, 'roster.json');
    const current = roster('thread-current');
    // If the stop guard regresses, fail closed before any real provider can start.
    const settings = { data: { settings: { codexBinaryPath: path.join(root, 'missing-provider-runtime') } } };
    await writeFile(statePath, JSON.stringify(current));
    await writeFile(path.join(stateDirectory, 'settings.json'), JSON.stringify(settings));
    await writeFile(path.join(archiveHome, 'roster.json'), JSON.stringify(roster('thread-recovered')));
    const backupPath = path.join(root, 'backup.tar');
    const archive = spawnSync('tar', ['-cf', backupPath, '-C', archiveDirectory, product.homeDirectory], { encoding: 'utf8' });
    expect(archive.status, archive.stderr).toBe(0);
    await writeFile(path.join(bin, 'ps'), '#!/bin/sh\nprintf "%s\\n" "$APP_TEST_PS_OUTPUT"\n', { mode: 0o700 });

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./recover-compressed-session.mjs', import.meta.url)),
      backupPath,
      '/tmp/repo',
    ], {
      encoding: 'utf8',
      timeout: 1_500,
      env: {
        ...process.env,
        HOME: root,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        APP_HOME: stateDirectory,
        APP_STATE_PATH: statePath,
        APP_CODEX_HOME: path.join(root, 'codex-home'),
        APP_TEST_PS_OUTPUT: `123 ${command}`,
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${product.name} is still running.`);
    expect(await readFile(statePath, 'utf8')).toBe(JSON.stringify(current));
    expect((await readdir(stateDirectory)).sort()).toEqual(['roster.json', 'settings.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function roster(threadId) {
  return {
    schemaVersion: 1,
    writtenBy: 'daemon test',
    data: {
      agents: [{
        id: 'agent-1',
        folder: '/tmp/repo',
        engine: { kind: 'codex', session: { threadId } },
        updatedAt: 'before',
      }],
    },
  };
}

function state(threadId) {
  return {
    agents: [{
      id: 'agent-1',
      provider: 'codex',
      folder: '/tmp/repo',
      providerSession: { kind: 'codex', threadId },
      updatedAt: 'before',
    }],
    theme: 'system',
  };
}
