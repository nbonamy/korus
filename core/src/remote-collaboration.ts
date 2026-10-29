import type { Agent, AppSnapshot } from './contracts';
import type { ExecutionSelectionOverrides } from './contracts/execution';
import type { TaskContract } from './delegated-task';
import type { DelegationStartingContext } from './delegation-context';

export type CreateCoAgentInput = {
  remoteConnectionId?: string;
  goal?: boolean;
  requestId?: string;
  task?: TaskContract;
  selection?: ExecutionSelectionOverrides;
  branchName?: string;
  createWorktree?: boolean;
  destinationPath?: string;
  name?: string;
  prompt?: string;
  instructions?: string;
  startingContext?: DelegationStartingContext;
  repoPath: string;
};

export type RemoteWorkerRequest = {
  ownerId: string;
  teamId: string;
  agentId: string;
  caller: Agent;
  /** Controller-confirmed parent on the receiving host; its session is resolved there. */
  localCallerId?: string;
  input: CreateCoAgentInput;
  assignmentPrompt?: string;
  userInstructions?: Agent['delegationUserInstructions'];
};
export type RemoteWorkerResult = { agent: Agent; snapshot: AppSnapshot };
export type RemoteCollaborationCall = { ownerId: string; agentId: string; name: string; arguments: Record<string, unknown> };
export type RemoteCollaborationReply = { ownerId: string; result: unknown };

export function isRemoteCollaborationReply(value: unknown, ownerId: unknown): value is RemoteCollaborationReply {
  return typeof ownerId === 'string' && ownerId.length > 0 && typeof value === 'object' && value !== null && 'ownerId' in value && value.ownerId === ownerId && 'result' in value;
}

/** These operations have one authority for a mixed-host team. Execution tools remain host-owned. */
export const remoteCollaborationTools = new Set([
  'list-hosts', 'list-agents', 'send-message', 'check-messages', 'broadcast-message',
  'list-repos', 'list-worktrees', 'create-worktree', 'create-agent', 'close-agent',
  'wait-tasks', 'cancel-task', 'complete-task',
]);
