import type { Agent, ProviderConversationFrame, Team } from '@workspace/core/contracts';

/** Only authoritative provider resets cross this bounded, read/send companion seam. */
export type CompanionConversation = Extract<ProviderConversationFrame, {
  type: 'codex.conversationSnapshotChanged' | 'claude.conversationSnapshotChanged' | 'antigravity.conversationSnapshotChanged';
}>;
export type CompanionWorkspace = { teams: Team[]; agents: Agent[]; repositoryIcons?: Record<string, string> };
export type CompanionSession = {
  getWorkspace(): Promise<CompanionWorkspace>;
  loadConversation(agentId: string): Promise<CompanionConversation | null>;
  sendPrompt(agentId: string, prompt: string, clientCommandId?: string): Promise<void>;
  commandStatus?(clientCommandId: string): Promise<'accepted' | 'unresolved' | 'notReceived'>;
  onUpdate?(listener: (workspace: CompanionWorkspace, conversation: CompanionConversation | null) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): void;
};
/** Host transport owns pairing and encrypted routing; Vue consumes app-owned reads and actions. */
export type CompanionConnector = {
  laptops: readonly { id: string; name: string }[];
  connect(laptopId: string): Promise<CompanionSession>;
  revoke(laptopId: string): Promise<void>;
  initialize?(): Promise<void>;
  /** False when the build carries no relay: pairing is unavailable rather than misdirected. */
  relayConfigured?: boolean;
  pair?(code: string, deviceName: string, pending: () => void): Promise<string>;
  dispose?(): Promise<void>;
  suspend?(): Promise<void>;
  resume?(): Promise<void>;
};
/** A failure the person can act on; `message` is a `mobile.errors.*` catalog key. */
export class PairingError extends Error {}
