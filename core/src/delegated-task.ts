import type { AgentBackend, BackendSession } from './contracts';

export type TaskState = 'preparing' | 'running' | 'needs-input' | 'interrupted' | 'failed' | 'completed' | 'cancelled';
export type TaskContract = { title: string; doneWhen: string };
export type TaskWorkspace = { repositoryPath: string; branchName?: string; destinationPath?: string; remoteConnectionId?: string };
export type TaskResultInput = { summary: string; evidence: string[]; artifacts: string[]; caveats: string[] };
export type TaskAcceptance = { backendSession: BackendSession; turnId?: string };
export type DelegatedTask = {
  id: string;
  requestId: string;
  requestFingerprint: string;
  parentAgentId: string;
  workerAgentId: string;
  backend: AgentBackend;
  assignment: TaskContract;
  prompt: string;
  goal?: boolean;
  delegationUserInstructions?: import('./delegation-context').DelegationUserInstructions;
  workspace?: TaskWorkspace;
  attemptId: string;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  folder?: string;
  acceptance?: TaskAcceptance;
  executionTurnId?: string;
  submission?: TaskResultInput & { id: string; attemptId: string; turnId: string; backendSession: BackendSession };
  delivery?: {
    id: string;
    state: 'pending' | 'sending' | 'accepted' | 'uncertain';
    acceptance?: TaskAcceptance;
  };
  parentWakeBlocked: boolean;
  /** Explicit stop/recovery blocks survive later provider outcome corrections. */
  parentStopRequested?: boolean;
  detail?: string;
};

export type WaitTasksInput = { taskIds?: string[]; mode?: 'any' | 'all'; timeoutMs?: number };
export type WaitTasksResult = { tasks: DelegatedTask[]; timedOut: boolean };
