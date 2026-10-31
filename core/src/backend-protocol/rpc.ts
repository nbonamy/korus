import { backendMethods } from './methods';
import type {
  AgentGitBranchInput,
  AgentGitCommitInput,
  AgentGitMergeInput,
  AgentGitMessageGenerationInput,
  AgentGitMessageGenerationResult,
  AgentGitPullRequestInput,
  AgentGitPushInput,
  AgentGitStageInput,
  AgentGitUpdateFromBaseInput,
  AgentGitPullInput,
  AgentGitRevertInput,
  AgentGitPullResult,
  AgentGitUpdateFromBaseResult,
  AgentGitDiffTarget,
  AgentGitWorkflow,
  AppSnapshot,
  ClientState,
} from '../contracts';
import { isAppSnapshot, isClientState } from '../snapshot-guards';

export type { AppBackendEvent } from './events';

export type AppRpcId = string | number;

export type AppRpcRequest = {
  jsonrpc: '2.0';
  id: AppRpcId;
  method: string;
  params?: unknown;
};

export type AppRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type AppRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type AppRpcResponse =
  | { jsonrpc: '2.0'; id: AppRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: AppRpcId | null; error: AppRpcError };

export type AppRpcMessage = AppRpcRequest | AppRpcNotification | AppRpcResponse;

export const appRpcErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  backendUnavailable: -32000,
  timeout: -32001,
} as const;

export type AppBackendHealth = {
  ok: true;
  name: string;
  version: string;
  pid: number;
};

export type AppSnapshotGetResult = {
  snapshot: AppSnapshot;
  lastEventSeq: number;
  clientState: ClientState;
};

export type AppBackendRequestMap = {
  [backendMethods.agentConversationTurnHistoryLoad]: { params: { agentId: string; turnId: string }; result: void };
  [backendMethods.driverConversationTurnHistoryLoad]: { params: { agent: import('../contracts').Agent; turnId: string }; result: void };
  [backendMethods.agentRunProfilesGet]: { params: { agentId: string }; result: import('../run-profiles').RunProfileCatalog };
  [backendMethods.agentRunProfileActionsGet]: { params: { agentId: string; directory: string }; result: import('../run-profiles').RunProfileDiscovery };
  [backendMethods.agentRunProfileSave]: { params: { agentId: string; input: import('../run-profiles').RunProfileInput }; result: import('../run-profiles').RunProfileCatalog };
  [backendMethods.agentRunProfileDelete]: { params: { agentId: string; profileId: string }; result: import('../run-profiles').RunProfileCatalog };
  [backendMethods.agentRunProfileStart]: { params: { agentId: string; input: import('../run-profiles').RunProfileStartInput }; result: import('../run-profiles').ProfileRun };
  [backendMethods.agentProfileRunStop]: { params: { agentId: string; runId: string }; result: import('../run-profiles').ProfileRun };
  [backendMethods.agentProfileRunsStop]: { params: { agentId: string }; result: void };
  [backendMethods.guestConversationControl]: { params: { input: import('../guest-navigation').GuestJoinControl }; result: import('../guest-navigation').GuestJoinState };
  [backendMethods.guestConversationImage]: { params: { id: string; path: string }; result: { dataUrl: string } };
  [backendMethods.guestConversationContent]: { params: { id: string; input: import('../contracts/conversation').ConversationContentInput }; result: import('../contracts/conversation').ConversationContentChunk };
  [backendMethods.conversationShareControl]: { params: { input: import('../conversation-sharing').ConversationShareControl }; result: import('../conversation-sharing').ConversationShareResult };
  [backendMethods.repositoryDeletePreview]: { params: { agentId: string }; result: import('../contracts/workspace').RepositoryDeletionPreview };
  [backendMethods.repositoryDelete]: { params: { agentId: string; input: import('../contracts/workspace').DeleteRepositoryInput }; result: AppSnapshot };
  [backendMethods.browserExtensionPackages]: { params: { input: import('../browser-extensions').BrowserExtensionPackageRequest }; result: import('../browser-extensions').BrowserExtensionPackageState };
  [backendMethods.agentMarkRead]: { params: { agentId: string; revision: number }; result: null };
  [backendMethods.agentDesign]: { params: { agentId: string; input: import('../design').DesignRequest<import('../contracts').PromptAttachment> }; result: import('../design').DesignResult };
  [backendMethods.agentVisualizeStart]: {
    params: { agentId: string; input?: import('../visualize').StartVisualizeInput };
    result: AppSnapshot;
  };
  [backendMethods.agentVisualizeOpenSet]: {
    params: { agentId: string; input: import('../visualize').SetVisualizeOpenInput };
    result: AppSnapshot;
  };
  [backendMethods.agentVisualizationSuggestionGenerate]: {
    params: { agentId: string; input: import('../visualize').GenerateVisualizationSuggestionInput };
    result: AppSnapshot;
  };
  [backendMethods.agentVisualizationSelect]: {
    params: { agentId: string; input: import('../visualize').SelectVisualizationInput };
    result: AppSnapshot;
  };
  [backendMethods.agentVisualizationDelete]: {
    params: { agentId: string; input: import('../visualize').DeleteVisualizationInput };
    result: AppSnapshot;
  };
  [backendMethods.agentVisualizationCanvasSave]: {
    params: { agentId: string; input: import('../visualize-canvas').SaveCanvasInput };
    result: import('../visualize-canvas').CanvasDocument;
  };
  [backendMethods.agentVisualizationAssetGet]: {
    params: { agentId: string; visualizationId: string };
    result: import('../visualize').VisualizationAsset;
  };
  [backendMethods.agentThreadFlagRespond]: {
    params: { agentId: string; response: import('../thread-flags').ThreadFlagResponse };
    result: AppSnapshot;
  };
  [backendMethods.agentPlanReviewRespond]: {
    params: { agentId: string; response: import('../plan-review').PlanReviewResponse };
    result: AppSnapshot;
  };
  [backendMethods.agentRequestRespond]: {
    params: { response: import('../agent-request').AgentRequestResponse };
    result: AppSnapshot;
  };
  [backendMethods.driverConversationArchive]: {
    params: { agent: import('../contracts').Agent };
    result: { supported: boolean };
  };
  [backendMethods.driverConversationDelete]: {
    params: { agent: import('../contracts').Agent };
    result: { supported: boolean };
  };
  [backendMethods.backendHealthGet]: {
    params: undefined;
    result: AppBackendHealth;
  };
  [backendMethods.snapshotGet]: {
    params: undefined;
    result: AppSnapshotGetResult;
  };
  [backendMethods.clientStateGet]: {
    params: undefined;
    result: ClientState;
  };
  [backendMethods.agentGitLogGet]: {
    params: { agentId: string; input?: import('../contracts').AgentGitLogInput };
    result: import('../contracts').AgentGitLogPage;
  };
  [backendMethods.agentGitLogCommitGet]: {
    params: { agentId: string; input: import('../contracts').AgentGitLogCommitInput };
    result: import('../contracts').AgentGitLogDetails;
  };
  [backendMethods.agentGitLogFileGet]: {
    params: { agentId: string; input: import('../contracts').AgentGitLogFileInput };
    result: import('../contracts').AgentGitLogFileDiff;
  };
  [backendMethods.agentGitDiffGet]: {
    params: { agentId: string; target?: AgentGitDiffTarget };
    result: import('../contracts').AgentGitDiff;
  };
  [backendMethods.agentGitBranchWorkPreview]: {
    params: { agentId: string };
    result: import('../branch-current-work').BranchWorkPreview;
  };
  [backendMethods.agentGitBranchWork]: {
    params: { agentId: string; input: import('../branch-current-work').BranchWorkInput };
    result: import('../branch-current-work').BranchWorkResult;
  };
  [backendMethods.agentGitWorkflowGet]: {
    params: { agentId: string; includePullRequest?: boolean };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentClosePreview]: {
    params: { agentId: string };
    result: import('../agent-close').AgentClosePreview;
  };
  [backendMethods.agentTasksList]: {
    params: { agentId: string };
    result: import('../delegated-task').DelegatedTask[];
  };
  [backendMethods.collaborationTaskAccess]: {
    params: { teamId: string; ownerId: string; agentId: string; action: 'list' | 'cancel' | 'block'; taskId?: string };
    result: import('../delegated-task').DelegatedTask[] | import('../delegated-task').DelegatedTask | null;
  };
  [backendMethods.collaborationTeamBind]: {
    params: { teamId: string; ownerId: string };
    result: AppSnapshot;
  };
  [backendMethods.collaborationWorkerCreate]: {
    params: import('../remote-collaboration').RemoteWorkerRequest;
    result: import('../remote-collaboration').RemoteWorkerResult;
  };
  [backendMethods.collaborationPromptSend]: {
    params: { agentId: string; prompt: string; goal?: boolean; planMode?: boolean };
    result: import('../backend-driver').BackendSendResult;
  };
  [backendMethods.collaborationMessageSend]: {
    params: { agentId: string; messageId: string; prompt: string };
    result: { accepted: true };
  };
  [backendMethods.clientCollaborationCall]: {
    params: import('../remote-collaboration').RemoteCollaborationCall;
    result: import('../remote-collaboration').RemoteCollaborationReply;
  };
  [backendMethods.agentTaskCancel]: {
    params: { agentId: string; taskId: string };
    result: import('../delegated-task').DelegatedTask;
  };
  [backendMethods.agentGitMessageGenerate]: {
    params: { agentId: string; input: AgentGitMessageGenerationInput };
    result: AgentGitMessageGenerationResult;
  };
  [backendMethods.agentGitStage]: {
    params: { agentId: string; input: AgentGitStageInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitCommit]: {
    params: { agentId: string; input: AgentGitCommitInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitPush]: {
    params: { agentId: string; input: AgentGitPushInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitBranchCreate]: {
    params: { agentId: string; input: AgentGitBranchInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitPullRequestCreate]: {
    params: { agentId: string; input: AgentGitPullRequestInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitMerge]: {
    params: { agentId: string; input: AgentGitMergeInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitUpdateFromBase]: {
    params: { agentId: string; input: AgentGitUpdateFromBaseInput };
    result: AgentGitUpdateFromBaseResult;
  };
  [backendMethods.agentGitPull]: {
    params: { agentId: string; input: AgentGitPullInput };
    result: AgentGitPullResult;
  };
  [backendMethods.agentGitRevert]: {
    params: { agentId: string; input: AgentGitRevertInput };
    result: AgentGitWorkflow;
  };
  [backendMethods.agentGitPruneGet]: {
    params: { agentId: string };
    result: import('../contracts').GitPruneInventory;
  };
  [backendMethods.agentGitPrune]: {
    params: { agentId: string; input: import('../contracts').GitPruneInput };
    result: import('../contracts').GitPruneResult;
  };
};

export type AppBackendRequestMethod = keyof AppBackendRequestMap;
export type AppBackendRequestParams<Method extends AppBackendRequestMethod> = AppBackendRequestMap[Method]['params'];
export type AppBackendRequestResult<Method extends AppBackendRequestMethod> = AppBackendRequestMap[Method]['result'];

export type AppBackendRequestPort = {
  request<Result>(method: string, params?: unknown): Promise<Result>;
};

export function requestAppBackend<Method extends AppBackendRequestMethod>(
  client: AppBackendRequestPort,
  method: Method,
  ...args: AppBackendRequestParams<Method> extends undefined
    ? [params?: undefined]
    : [params: AppBackendRequestParams<Method>]
): Promise<AppBackendRequestResult<Method>> {
  return client.request<AppBackendRequestResult<Method>>(method, args[0]);
}

export function isAppSnapshotGetResult(value: unknown): value is AppSnapshotGetResult {
  return isRecord(value) &&
    isAppSnapshot(value.snapshot) &&
    typeof value.lastEventSeq === 'number' &&
    isClientState(value.clientState);
}

export function isAppRpcRequest(message: AppRpcMessage): message is AppRpcRequest {
  return 'id' in message && 'method' in message;
}

export function isAppRpcNotification(message: AppRpcMessage): message is AppRpcNotification {
  return !('id' in message) && 'method' in message;
}

export function isAppRpcResponse(message: AppRpcMessage): message is AppRpcResponse {
  return 'id' in message && ('result' in message || 'error' in message);
}

export function createAppRpcResult(id: AppRpcId | null, result: unknown): AppRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createAppRpcRequest(id: AppRpcId, method: string, params?: unknown): AppRpcRequest {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}

export function createAppRpcNotification(method: string, params?: unknown): AppRpcNotification {
  return params === undefined
    ? { jsonrpc: '2.0', method }
    : { jsonrpc: '2.0', method, params };
}

export function createAppRpcError(id: AppRpcId | null, code: number, message: string, data?: unknown): AppRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function parseAppRpcMessage(input: unknown): AppRpcMessage {
  if (!isRecord(input) || input.jsonrpc !== '2.0') {
    throw new AppRpcValidationError('Invalid JSON-RPC message.');
  }

  if ('method' in input) {
    if (typeof input.method !== 'string' || input.method.length === 0) {
      throw new AppRpcValidationError('JSON-RPC method must be a non-empty string.');
    }

    if ('id' in input) {
      if (!isAppRpcId(input.id)) {
        throw new AppRpcValidationError('JSON-RPC request id must be a string or number.');
      }

      return {
        jsonrpc: '2.0',
        id: input.id,
        method: input.method,
        ...('params' in input ? { params: input.params } : {}),
      };
    }

    return {
      jsonrpc: '2.0',
      method: input.method,
      ...('params' in input ? { params: input.params } : {}),
    };
  }

  if ('id' in input && ('result' in input || 'error' in input)) {
    if (input.id !== null && !isAppRpcId(input.id)) {
      throw new AppRpcValidationError('JSON-RPC response id must be a string, number, or null.');
    }

    if ('error' in input) {
      if (!isRecord(input.error) || typeof input.error.code !== 'number' || typeof input.error.message !== 'string') {
        throw new AppRpcValidationError('JSON-RPC error response is malformed.');
      }

      return {
        jsonrpc: '2.0',
        id: input.id,
        error: {
          code: input.error.code,
          message: input.error.message,
          ...('data' in input.error ? { data: input.error.data } : {}),
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: input.id,
      result: input.result,
    };
  }

  throw new AppRpcValidationError('JSON-RPC message must be a request, notification, or response.');
}

export class AppRpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppRpcValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppRpcId(value: unknown): value is AppRpcId {
  return typeof value === 'string' || typeof value === 'number';
}
