import type { AppSnapshot, ClientState } from './contracts';
import { isSnapshotMetadata } from './snapshot-guard-metadata';
import { isBoolean, isRecord, optional } from './snapshot-guard-primitives';
import { withConversationId } from './legacy-conversation-id';

export type DecodedAppSnapshot = { value: AppSnapshot };

export function decodeAppSnapshot(received: unknown): DecodedAppSnapshot | null {
  const value = withAgentConversationIds(received);
  if (!isSnapshotMetadata(value)) return null;
  return { value: value as AppSnapshot };
}

/** Snapshots from earlier builds, including cached ones, name each agent's conversation `threadId` or `sessionId`. */
function withAgentConversationIds(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.agents)) return value;
  const agents = value.agents.map(agent => isRecord(agent) && isRecord(agent.providerSession) && !('conversationId' in agent.providerSession)
    ? { ...agent, providerSession: withConversationId(agent.providerSession) } : agent);
  return agents.every((agent, index) => agent === (value.agents as unknown[])[index]) ? value : { ...value, agents };
}

export function isAppSnapshot(value: unknown): value is AppSnapshot {
  return decodeAppSnapshot(value) !== null;
}

export function isClientState(value: unknown): value is ClientState {
  return isRecord(value) &&
    typeof value.sourceFolderPath === 'string' &&
    typeof value.shouldPreventDisplaySleep === 'boolean' &&
    optional(value, 'shouldPreventDisplaySleepForRemoteAccess', isBoolean);
}
