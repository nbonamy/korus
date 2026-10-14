import type { AgentBackend, AgentModelSelection, BackendModelOption, BackendSkillSummary, PromptSkillInput, ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionNewChat, CompanionRequestReply, CompanionCloseOptions, CompanionClosePreview, CompanionTarget } from '@workspace/core/companion-protocol';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';

/** Only authoritative provider resets cross this bounded, read/send companion seam. */
export type CompanionConversation = Extract<ProviderConversationFrame, {
  type: 'codex.conversationSnapshotChanged' | 'claude.conversationSnapshotChanged' | 'antigravity.conversationSnapshotChanged';
}>;
export type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
/** The composer choices that travel with a prompt, as the desktop sends them. */
export type CompanionPromptOptions = { skills?: PromptSkillInput[]; model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null; planMode?: boolean; inputMethod?: 'typed' | 'dictated';
  delegation?: { startingContext: 'conversation' | 'handoff'; instructions?: string } };
/** Where and how a review of an agent's changes starts. */
export type CompanionReviewInput = { scope: { type: 'uncommitted' } | { type: 'branch'; baseRef: string }; threadMode: 'current' | 'independent'; instructions?: string };
/** A file travelling with a prompt, already reduced to fit one relay frame. */
export type CompanionUpload = { type: 'image' | 'file'; name: string; mimeType: string; data: string };
export type CompanionHistoryPage = { frame: CompanionConversation; hasOlder: boolean };
export type CompanionHistoryState = { hasOlder: boolean; loadingOlder: boolean; failed: boolean };
export type CompanionSession = {
  respondRequest?(reply: CompanionRequestReply): Promise<void>;
  getWorkspace(): Promise<CompanionWorkspace>;
  deselectConversation?(): void;
  cachedConversation?(agentId: string): CompanionConversation | null | undefined;
  loadConversation(agentId: string): Promise<CompanionConversation | null>;
  loadOlderHistory?(agentId: string): Promise<CompanionHistoryPage>;
  readConversationContent?(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  sendPrompt(agentId: string, prompt: string, clientCommandId?: string, options?: CompanionPromptOptions, attachments?: CompanionUpload[]): Promise<void>;
  listModels?(agentId: string): Promise<BackendModelOption[]>;
  listSkills?(agentId: string): Promise<BackendSkillSummary[]>;
  selectModel?(agentId: string, selection: AgentModelSelection): Promise<void>;
  interrupt?(agentId: string): Promise<void>;
  restartSession?(agentId: string): Promise<void>;
  previewCloseSession?(agentId: string): Promise<CompanionClosePreview>;
  closeSession?(target: CompanionTarget, input?: CompanionCloseOptions): Promise<void>;
  /** Resolves with the new agent once the laptop has made the worktree, if any, and the chat. */
  createChat?(chat: CompanionNewChat, signal?: AbortSignal): Promise<string>;
  createQuickChat?(chat: { teamId: string; backend: AgentBackend }, signal?: AbortSignal): Promise<string>;
  setBackend?(agentId: string, backend: AgentBackend): Promise<void>;
  startReview?(agentId: string, input: CompanionReviewInput): Promise<void>;
  setApprovalPreset?(agentId: string, preset: string): Promise<void>;
  setPermissionMode?(agentId: string, mode: string): Promise<void>;
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
