import { TypedIpcMain } from '@codex-app-sdk/electron';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { requestAppBackend } from '@workspace/core/backend-protocol/rpc';
import { ipcChannels, type AppIpcRequests } from '@workspace/core/ipc';
import { encodedAppError } from '@workspace/core/app-error';
import type { AppBackendClientPort } from './backend-client';

export function registerAgentGitIpcHandlers(
  ipc: TypedIpcMain<AppIpcRequests>,
  getBackendClient: () => AppBackendClientPort,
): void {
  ipc.handle(ipcChannels.getAgentClosePreview, (_event, agentId) => requestAppBackend(getBackendClient(), backendMethods.agentClosePreview, { agentId }));
  ipc.handle(ipcChannels.getAgentGitPrune, (_event, agentId) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitPruneGet, { agentId })
  ));
  ipc.handle(ipcChannels.pruneAgentGit, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitPrune, { agentId, input })
  ));
  ipc.handle(ipcChannels.getAgentGitLog, (_event, agentId, input) => requestAppBackend(getBackendClient(), backendMethods.agentGitLogGet, { agentId, input }));
  ipc.handle(ipcChannels.getAgentGitLogCommit, (_event, agentId, input) => requestAppBackend(getBackendClient(), backendMethods.agentGitLogCommitGet, { agentId, input }));
  ipc.handle(ipcChannels.getAgentGitLogFile, (_event, agentId, input) => requestAppBackend(getBackendClient(), backendMethods.agentGitLogFileGet, { agentId, input }));
  ipc.handle(ipcChannels.getAgentGitDiff, async (_event, agentId, target) => {
    return requestAppBackend(getBackendClient(), backendMethods.agentGitDiffGet, { agentId, target });
  });
  ipc.handle(ipcChannels.previewBranchCurrentWork, (_event, agentId) => requestAppBackend(getBackendClient(), backendMethods.agentGitBranchWorkPreview, { agentId }));
  ipc.handle(ipcChannels.branchCurrentWork, (_event, agentId, input) => requestAppBackend(getBackendClient(), backendMethods.agentGitBranchWork, { agentId, input }));
  ipc.handle(ipcChannels.getAgentGitWorkflow, (_event, agentId) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitWorkflowGet, { agentId })
  ));
  ipc.handle(ipcChannels.generateAgentGitMessage, async (_event, agentId, input) => {
    try {
      return await requestAppBackend(getBackendClient(), backendMethods.agentGitMessageGenerate, { agentId, input });
    } catch (error) {
      throw encodedAppError(error);
    }
  });
  ipc.handle(ipcChannels.stageAgentGitFiles, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitStage, { agentId, input })
  ));
  ipc.handle(ipcChannels.commitAgentGitChanges, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitCommit, { agentId, input })
  ));
  ipc.handle(ipcChannels.pushAgentGitBranch, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitPush, { agentId, input })
  ));
  ipc.handle(ipcChannels.pullAgentGitBranch, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitPull, { agentId, input })
  ));
  ipc.handle(ipcChannels.revertAgentGitChanges, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitRevert, { agentId, input })
  ));
  ipc.handle(ipcChannels.createAgentGitBranch, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitBranchCreate, { agentId, input })
  ));
  ipc.handle(ipcChannels.createAgentGitPullRequest, async (_event, agentId, input) => {
    try {
      return await requestAppBackend(getBackendClient(), backendMethods.agentGitPullRequestCreate, { agentId, input });
    } catch (error) {
      throw encodedAppError(error);
    }
  });
  ipc.handle(ipcChannels.mergeAgentGitBranch, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitMerge, { agentId, input })
  ));
  ipc.handle(ipcChannels.updateAgentGitBranchFromBase, (_event, agentId, input) => (
    requestAppBackend(getBackendClient(), backendMethods.agentGitUpdateFromBase, { agentId, input })
  ));
}
