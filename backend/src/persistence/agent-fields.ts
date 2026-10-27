import type { Agent } from '@workspace/core/contracts';
import type { PersistedAgent } from '../state-persistence';

type Policy = 'persisted' | 'derived' | 'runtime';

/**
 * Where each Agent field lives. A new field fails the build until it is listed here, and a
 * field marked persisted must exist on PersistedAgent, so nothing is stored or lost by accident.
 */
const agentFieldPolicy = {
  id: 'persisted',
  handoff: 'persisted',
  teamId: 'derived',
  delegatedByAgentId: 'persisted',
  delegationContext: 'persisted',
  userDelegationOverrides: 'persisted',
  delegationUserInstructions: 'persisted',
  pullRequest: 'persisted',
  sessionKind: 'persisted',
  sharedConversation: 'persisted',
  name: 'persisted',
  conversationTitle: 'persisted',
  avatar: 'persisted',
  folder: 'persisted',
  workspace: 'persisted',
  backend: 'persisted',
  backendSession: 'persisted',
  hasSubmittedPrompt: 'persisted',
  readState: 'persisted',
  backendDefaults: 'persisted',
  openInApplication: 'persisted',
  gitDiffTarget: 'persisted',
  contextUsage: 'persisted',
  plan: 'persisted',
  planReview: 'persisted',
  codeReview: 'persisted',
  threadFlags: 'persisted',
  suggestedPrompt: 'persisted',
  rateLimitPause: 'persisted',
  goal: 'persisted',
  visualize: 'persisted',
  isRegistered: 'runtime',
  mcpSessionId: 'runtime',
  statusText: 'persisted',
  status: 'runtime',
  createdAt: 'persisted',
  lastActivityAt: 'persisted',
  updatedAt: 'persisted',
} as const satisfies Record<keyof Agent, Policy>;

type FieldsWith<P extends Policy> = { [K in keyof Agent]-?: (typeof agentFieldPolicy)[K] extends P ? K : never }[keyof Agent];
type MissingFromPersistedAgent = Exclude<FieldsWith<'persisted'>, keyof PersistedAgent>;
type PersistedButUnclassified = Exclude<keyof PersistedAgent, FieldsWith<'persisted' | 'derived'>>;

const persistedAgentFieldsMatchPolicy: [MissingFromPersistedAgent, PersistedButUnclassified] extends [never, never] ? true : never = true;
void persistedAgentFieldsMatchPolicy;
