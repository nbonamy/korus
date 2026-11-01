import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { dialog } from 'electron';
import { isAppSnapshotGetResult } from '@workspace/core/backend-protocol/rpc';
import type { AppSnapshot } from '@workspace/core/contracts';
import { AppBackendSocketClient } from './backend-socket-client';
import { getDaemonStatus, getResolvedDaemonVersion, refreshDaemon, type DaemonLaunchAgentDependencies } from './daemon-launch-agent';
import { logMain, warnMain } from './log';
import { mainT } from './i18n';

type SnapshotClient = {
  close(): Promise<void>;
  request<Result>(method: string, params?: unknown): Promise<Result>;
  start(): Promise<void>;
};

type ShowMessageBox = typeof dialog.showMessageBox;

export type DaemonStartupMaintenanceDependencies = DaemonLaunchAgentDependencies & {
  createSnapshotClient?: (socketPath: string) => SnapshotClient;
  getDaemonStatus?: typeof getDaemonStatus;
  getPackagedVersion?: typeof getResolvedDaemonVersion;
  refreshDaemon?: typeof refreshDaemon;
  showMessageBox?: ShowMessageBox;
};

export async function ensureCurrentDaemonForStartup(
  dependencies: DaemonStartupMaintenanceDependencies = {},
): Promise<void> {
  const readDaemonStatus = dependencies.getDaemonStatus ?? getDaemonStatus;
  const getPackagedVersion = dependencies.getPackagedVersion ?? getResolvedDaemonVersion;
  const status = await readDaemonStatus(dependencies);
  if (!status.supported || !status.installed || !status.running || !status.version) {
    return;
  }

  const packagedVersion = await getPackagedVersion(dependencies);
  if (!packagedVersion || packagedVersion === status.version) {
    return;
  }

  const active = await daemonHasActiveWork(status.socketPath, dependencies);
  if (active) {
    const response = await (dependencies.showMessageBox ?? dialog.showMessageBox)({
      buttons: [mainT('daemon.continueOld'), mainT('daemon.restartNow')],
      cancelId: 0,
      defaultId: 1,
      message: mainT('daemon.restartRequired'),
      type: 'info',
    });
    if (response.response !== 1) {
      logMain('daemon', 'continuing with stale daemon after app update', {
        daemonVersion: status.version,
        packagedVersion,
        pid: status.pid,
      });
      return;
    }
  }

  logMain('daemon', 'restarting stale daemon after app update', {
    daemonVersion: status.version,
    packagedVersion,
    pid: status.pid,
  });
  await (dependencies.refreshDaemon ?? refreshDaemon)(dependencies);
}

async function daemonHasActiveWork(
  socketPath: string,
  dependencies: DaemonStartupMaintenanceDependencies,
): Promise<boolean> {
  const client = dependencies.createSnapshotClient?.(socketPath) ?? new AppBackendSocketClient({ socketPath });
  try {
    await client.start();
    const result = await client.request<unknown>(backendMethods.snapshotGet);
    if (!isAppSnapshotGetResult(result)) {
      return true;
    }
    return snapshotHasActiveWork(result.snapshot);
  } catch (error) {
    warnMain('daemon', 'failed to inspect daemon activity before update restart', {
      detail: error instanceof Error ? error.message : String(error),
    });
    return true;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function snapshotHasActiveWork(snapshot: AppSnapshot): boolean {
  return snapshot.agents.some((agent) => (
    agent.status.type === 'working' ||
    agent.status.type === 'awaitingInput'
  )) || snapshot.automations.some((automation) => (
    automation.executionLog.some((entry) => entry.status === 'working')
  ));
}
