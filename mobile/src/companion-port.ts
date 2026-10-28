import type { CodexPromptPart } from '@codex-app-sdk/core/surface';
import type { CompanionCheckpoint, CompanionSync } from '@workspace/core/companion-journal';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { AgentBackend, ExecutionSelection, BackendModelOption, BackendSkillSummary, BackendPluginSummary, PromptSkillInput, ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionBranch, CompanionNewChat, CompanionRequestReply, CompanionCloseOptions, CompanionClosePreview, CompanionTarget } from '@workspace/core/companion-protocol';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { CompanionUsage, CompanionProjectInput, CompanionGitHubRepository } from '@workspace/core/companion-protocol';

/** Only authoritative provider resets cross this bounded, read/send companion seam. */
export type CompanionConversation = Extract<ProviderConversationFrame, {
  type: 'codex.conversationSnapshotChanged' | 'claude.conversationSnapshotChanged' | 'antigravity.conversationSnapshotChanged';
}>;
export type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
/** The composer choices that travel with a prompt, as the desktop sends them. */
export type CompanionPromptOptions = Omit<import('@workspace/core/contracts').RendererSendPromptOptions, 'attachments' | 'backendOptions'> & { followUpBehavior?: 'queue' | 'steer' };

/** Where and how a review of an agent's changes starts. */
export type { CompanionReviewInput } from '@workspace/core/companion-review';
import type { CompanionReviewInput, CompanionReviewSetup } from '@workspace/core/companion-review';
/** A file travelling with a prompt, already reduced to fit one relay frame. */
export type CompanionUpload = { type: 'image' | 'file'; name: string; mimeType: string; data: string };
export type CompanionHistoryPage = { frame: CompanionConversation; hasOlder: boolean };
export type CompanionHistoryState = { hasOlder: boolean; loadingOlder: boolean; failed: boolean };
/** The link to one laptop: whether the app is looking at it, when it is lost, and how it ends. */
type CompanionLink = {
  setActive?(active: boolean): Promise<void>;
  onDisconnect(listener: (reason?: string) => void): () => void;
  close(): void;
};
/** What the app can ask of the paired laptop over a link. */
type CompanionOperations = {
  createTeam?(name: string): Promise<string>;
  /** Move a finished mission on to review, or accept a ticket waiting for it; `revision` is the mission as the phone saw it. */
  finishReview?(missionId: string, revision: number): Promise<void>;
  continueMission?(missionId: string, revision: number): Promise<void>;
  acceptTicket?(missionId: string, revision: number, runId: string): Promise<void>;
  /** A review's findings: choose what to fix, fix it, and review again once nothing is open. */
  selectFinding?(missionId: string, revision: number, findingId: string, selected: boolean): Promise<void>;
  fixFindings?(missionId: string, revision: number): Promise<void>;
  rerunReview?(missionId: string, revision: number): Promise<void>;
  gitDiff?(agentId: string, scope: import('@workspace/core/contracts').AgentGitDiffTarget): Promise<import('@workspace/core/contracts').AgentGitDiff>;
  previewFile?(agentId: string, input: import('@workspace/core/companion-files').CompanionFileInput): Promise<import('@workspace/core/companion-files').CompanionFilePreview>;
  readImage?(agentId: string, path: string): Promise<import('@workspace/core/companion-protocol').CompanionImage>;
  repositoryCatalog?(teamId: string, provider: import('@workspace/core/companion-protocol').CompanionRepositoryProvider): Promise<CompanionGitHubRepository[]>;
  repositoryBranches?(teamId: string, provider: import('@workspace/core/companion-protocol').CompanionRepositoryProvider, repositoryId: string): Promise<import('@workspace/core/companion-protocol').CompanionProjectBranch[]>;
  githubBranches?(teamId: string, repositoryId: string): Promise<import('@workspace/core/companion-protocol').CompanionProjectBranch[]>;
  githubRepositories?(teamId: string): Promise<CompanionGitHubRepository[]>;
  localRepositories?(teamId: string): Promise<CompanionGitHubRepository[]>;
  localBranches?(teamId: string, repositoryId: string): Promise<import('@workspace/core/companion-protocol').CompanionProjectBranch[]>;
  duplicateAgent?(target: CompanionTarget, backend: AgentBackend): Promise<string>;
  renameAgent?(target: CompanionTarget, name: string): Promise<void>;
  createProject?(input: CompanionProjectInput, signal?: AbortSignal): Promise<string>;
  getUsage?(): Promise<CompanionUsage[]>;
  registerPush?(registration: CompanionPushRegistration | null): Promise<void>;
  onNotification?(listener: (notification: CompanionNotification) => void): () => void;
  markRead?(agentId: string, revision: number): Promise<void>;
  respondRequest?(reply: CompanionRequestReply): Promise<void>;
  getWorkspace(): Promise<CompanionWorkspace>;
  deselectConversation?(): void;
  isConversationCurrent?(agentId: string): boolean;
  cachedConversation?(agentId: string): CompanionConversation | null | undefined;
  loadConversation(agentId: string): Promise<CompanionConversation | null>;
  loadOlderHistory?(agentId: string): Promise<CompanionHistoryPage>;
  readConversationContent?(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  /** Prompts and reviews name the target captured when the person acted, so a replaced session is refused rather than retargeted. */
  sendPrompt(target: CompanionTarget, prompt: string, clientCommandId?: string, options?: CompanionPromptOptions, attachments?: CompanionUpload[]): Promise<void>;
  listModels?(agentId: string): Promise<BackendModelOption[]>;
  listPlugins?(agentId: string): Promise<BackendPluginSummary[]>;
  listSkills?(agentId: string): Promise<BackendSkillSummary[]>;
  selectModel?(agentId: string, selection: ExecutionSelection): Promise<void>;
  changeGoal?(target: CompanionTarget, objective: string | null): Promise<void>;
  updateQueuedPrompt?(target: CompanionTarget, promptId: string, action: 'steer' | 'delete'): Promise<void>;
  interrupt?(agentId: string): Promise<void>;
  restartSession?(agentId: string): Promise<void>;
  previewCloseSession?(agentId: string): Promise<CompanionClosePreview>;
  closeSession?(target: CompanionTarget, input?: CompanionCloseOptions): Promise<void>;
  listBranches?(teamId: string, repositoryId: string): Promise<CompanionBranch[]>;
  /** Resolves with the new agent once the laptop has made the worktree, if any, and the chat. */
  createChat?(chat: CompanionNewChat, signal?: AbortSignal): Promise<string>;
  createQuickChat?(chat: { teamId: string; backend: AgentBackend }, signal?: AbortSignal): Promise<string>;
  setBackend?(agentId: string, backend: AgentBackend): Promise<void>;
  reviewSetup?(agentId: string, backend?: AgentBackend): Promise<CompanionReviewSetup>;
  startReview?(target: CompanionTarget, input: CompanionReviewInput): Promise<string | void>;
  setApprovalPreset?(agentId: string, preset: string): Promise<void>;
  setPermissionMode?(agentId: string, mode: string): Promise<void>;
  commandStatus?(clientCommandId: string): Promise<'pending' | 'accepted' | 'rejected' | 'unresolved' | 'notReceived'>;
  onUpdate?(listener: (workspace: CompanionWorkspace, conversation: CompanionConversation | null) => void): () => void;
};
export type CompanionSession = CompanionLink & CompanionOperations;
/** Host transport owns pairing and encrypted routing; Vue consumes app-owned reads and actions. */
export type CompanionConnector = {
  laptops: readonly { id: string; name: string }[];
  cachedConversation?(target: CompanionTarget): CompanionConversation | null | undefined;
  conversationUpdates?(target: CompanionTarget, since: CompanionCheckpoint | null): CompanionSync | null;
  connect(laptopId: string): Promise<CompanionSession>;
  revoke(laptopId: string): Promise<void>;
  /** Gives a paired laptop the person's own name. */
  rename?(laptopId: string, name: string): Promise<void>;
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

/** A confirmed rejection preserves the draft and permits an explicit new send. */
export class PromptRejectedError extends Error {}
