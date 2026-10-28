import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonStatus } from '@workspace/core/contracts';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { ensureCurrentDaemonForStartup } from '../daemon-startup-maintenance';

describe('daemon startup maintenance', () => {
  it('restarts a stale idle daemon before startup connects to it', async () => {
    const refreshDaemon = vi.fn().mockResolvedValue(daemonStatus({ version: '0.2.0', pid: 456 }));

    await ensureCurrentDaemonForStartup({
      createSnapshotClient: () => snapshotClient(idleSnapshot()),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ version: '0.1.0', pid: 123 })),
      getPackagedVersion: vi.fn().mockResolvedValue('0.2.0'),
      refreshDaemon,
      showMessageBox: vi.fn() as never,
    });

    expect(refreshDaemon).toHaveBeenCalledOnce();
  });

  it('does not restart when the running daemon matches the packaged version', async () => {
    const refreshDaemon = vi.fn();

    await ensureCurrentDaemonForStartup({
      createSnapshotClient: () => snapshotClient(idleSnapshot()),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ version: '0.2.0' })),
      getPackagedVersion: vi.fn().mockResolvedValue('0.2.0'),
      refreshDaemon,
      showMessageBox: vi.fn() as never,
    });

    expect(refreshDaemon).not.toHaveBeenCalled();
  });

  it('leaves stopped installed daemons to the normal backend startup fallback', async () => {
    const getPackagedVersion = vi.fn();
    const refreshDaemon = vi.fn();

    await ensureCurrentDaemonForStartup({
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ running: false, version: undefined })),
      getPackagedVersion,
      refreshDaemon,
    });

    expect(getPackagedVersion).not.toHaveBeenCalled();
    expect(refreshDaemon).not.toHaveBeenCalled();
  });

  it('prompts for active stale daemons and restarts when the user accepts', async () => {
    const refreshDaemon = vi.fn().mockResolvedValue(daemonStatus({ version: '0.2.0', pid: 456 }));
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1 });

    await ensureCurrentDaemonForStartup({
      createSnapshotClient: () => snapshotClient(activeAgentSnapshot()),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ version: '0.1.0', pid: 123 })),
      getPackagedVersion: vi.fn().mockResolvedValue('0.2.0'),
      refreshDaemon,
      showMessageBox: showMessageBox as never,
    });

    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ['Continue with old backend', 'Restart backend now'],
      message: `${product.name} updated. The background backend must restart to use the latest version. Active agents or automations are running.`,
    }));
    expect(refreshDaemon).toHaveBeenCalledOnce();
  });

  it('keeps active stale daemons running when the user chooses to continue', async () => {
    const refreshDaemon = vi.fn();

    await ensureCurrentDaemonForStartup({
      createSnapshotClient: () => snapshotClient(activeAutomationSnapshot()),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ version: '0.1.0', pid: 123 })),
      getPackagedVersion: vi.fn().mockResolvedValue('0.2.0'),
      refreshDaemon,
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) as never,
    });

    expect(refreshDaemon).not.toHaveBeenCalled();
  });

  it('skips daemon maintenance when the packaged version cannot be resolved', async () => {
    const refreshDaemon = vi.fn();

    await ensureCurrentDaemonForStartup({
      createSnapshotClient: () => snapshotClient(idleSnapshot()),
      getDaemonStatus: vi.fn().mockResolvedValue(daemonStatus({ version: '0.1.0' })),
      getPackagedVersion: vi.fn().mockResolvedValue(null),
      refreshDaemon,
    });

    expect(refreshDaemon).not.toHaveBeenCalled();
  });
});

function daemonStatus(overrides: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    supported: true,
    installed: true,
    running: true,
    socketPath: `/Users/nicolas/${product.homeDirectory}/daemon.sock`,
    launchAgentPath: `/Users/nicolas/Library/LaunchAgents/${product.appId}.daemon.plist`,
    version: '0.1.0',
    pid: 123,
    ...overrides,
  };
}

function snapshotClient(snapshot: ReturnType<typeof createEmptySnapshot>) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn().mockResolvedValue({
      snapshot,
      lastEventSeq: 0,
      clientState: {
        sourceFolderPath: snapshot.sourceFolder.path,
        shouldPreventDisplaySleep: false,
      },
    }),
    start: vi.fn().mockResolvedValue(undefined),
  };
}

function idleSnapshot() {
  return createEmptySnapshot();
}

function activeAgentSnapshot() {
  const snapshot = createEmptySnapshot();
  snapshot.agents.push({
    id: 'agent-dina',
    teamId: snapshot.teams[0].id,
    name: 'Dina',
    folder: '/Users/nicolas/src/id8',
    backend: 'codex',
    status: { type: 'working' },
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  });
  snapshot.teams[0].agentIds.push('agent-dina');
  return snapshot;
}

function activeAutomationSnapshot() {
  const snapshot = createEmptySnapshot();
  snapshot.automations.push({
    id: 'automation-bugs',
    name: 'Bugs',
    enabled: true,
    prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-app', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

    schedule: { intervalMinutes: 60 },
    executionLog: [{
      id: 'execution-1',
      automationId: 'automation-bugs',
      startedAt: '2026-06-14T10:00:00.000Z',
      status: 'working',


    }],
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  });
  return snapshot;
}
