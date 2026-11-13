import type { TypedIpcMain } from '@korus-dev/agent-ui-sdk/electron';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels, type AppIpcRequests } from '@workspace/core/ipc';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { AppBackendClientPort } from './backend-client';

export function registerMissionIpcHandlers(
  ipc: TypedIpcMain<AppIpcRequests>,
  provider: () => AppBackendClientPort,
  adopt: (snapshot: AppSnapshot) => AppSnapshot | Promise<AppSnapshot>,
  select: (missionId: string | null) => void,
): void {
  ipc.handle(ipcChannels.executeMission, async (_event, input) => adopt(await provider().request<AppSnapshot>(backendMethods.missionExecute, { input })));
  ipc.handle(ipcChannels.createMission, async (_event, input) => adopt(await provider().request<AppSnapshot>(backendMethods.missionCreate, { input })));
  ipc.handle(ipcChannels.selectMission, (_event, missionId) => select(missionId));
  ipc.handle(ipcChannels.deleteMission, async (_event, input) => adopt(await provider().request<AppSnapshot>(backendMethods.missionDelete, { input })));
  ipc.handle(ipcChannels.readMissionArtifact, (_event, missionId, stage) => provider().request(backendMethods.missionArtifactRead, { missionId, stage }));
  ipc.handle(ipcChannels.updateMission, async (_event, input) => adopt(await provider().request<AppSnapshot>(backendMethods.missionUpdate, { input })));
}
