import type { Agent, ProviderConversationFrame, Team } from '@workspace/core/contracts';

/** Only authoritative provider resets cross this bounded, read/send companion seam. */
export type CompanionConversation = Extract<ProviderConversationFrame, {
  type: 'codex.conversationSnapshotChanged' | 'claude.conversationSnapshotChanged' | 'antigravity.conversationSnapshotChanged';
}>;
export type CompanionWorkspace = { teams: Team[]; agents: Agent[] };
export type CompanionSession = {
  getWorkspace(): Promise<CompanionWorkspace>;
  loadConversation(agentId: string): Promise<CompanionConversation>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  onDisconnect(listener: () => void): () => void;
  close(): void;
};
/** Demo pairing is local only. A network implementation requires an approved authenticated gateway. */
export type CompanionConnector = {
  laptops: readonly { id: string; name: string }[];
  connect(laptopId: string): Promise<CompanionSession>;
  revoke(laptopId: string): Promise<void>;
};
