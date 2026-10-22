import type { CompanionCheckpoint, CompanionSync } from '@workspace/core/companion-journal';
import { PromptRejectedError } from '../agents/prompt-rejected';
import type { CompanionNotification, CompanionPushRegistration } from '@workspace/core/companion-notification';
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import type { BackendHistoryLoadResult } from '@workspace/core/backend-driver';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { CompanionSubscription } from './subscription';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentBackend, AgentGitDiff, AgentGitDiffTarget, BackendSkillSummary, BackendPluginSummary, SourceBranch } from '@workspace/core/contracts';
import type { CompanionReviewSetup } from '@workspace/core/companion-review';
import type { CompanionCloseOptions, CompanionClosePreview, CompanionGrant, CompanionPending, CompanionReset, CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';
import { companionSessionId, companionMaxUploadBytes, companionMaxUploads, isConversationReset } from '@workspace/core/companion-protocol';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { canSelectAgentBackend } from '@workspace/core/agent-backends';
import { opaquePath, projectCompanionWorkspace } from '@workspace/core/companion-projection';
import { ChatCreations } from './chat-creations';
import { WindowBudget } from './source-budget';
import { CommandLedger, type SettledCommand, type StoredCommand } from './command-ledger';
import type { CompanionUsage, CompanionProjectInput, CompanionGitHubRepository, CompanionProjectBranch } from '@workspace/core/companion-protocol';
import type { CompanionUpload } from './uploads';
import { generatePairingCode, normalizePairingCode, pairingLifetimeMs } from '@workspace/core/companion-pairing';
import { conversationImageReference } from './images';
import { companionMaxDevices, companionMaxInvitations } from '@workspace/core/companion-relay';
import { pushRegistrationSchema } from './push-registration';

const identity = z.string().min(1).max(200);
const targetSchema = z.object({ hostId: identity, locationId: identity, teamId: identity, agentId: identity, sessionId: z.string().max(500).nullable() }).strict();
const requestOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answered'), answers: z.record(z.string().min(1).max(500), z.object({ answers: z.array(z.string().max(100_000)).max(100) }).strict()) }).strict(),
  z.object({ kind: z.literal('decision'), decision: z.enum(['allow', 'allow_conversation', 'always_allow', 'deny']) }).strict(),
  z.object({ kind: z.literal('cancelled') }).strict(),
]);
const closeInputSchema = z.object({ deleteWorktree: z.literal(true), deleteRemoteBranch: z.boolean(), discardChanges: z.boolean(), confirmed: z.literal(true) }).strict();
/** What a phone may ask of a prompt beyond its text: the same composer choices the desktop sends. */
const promptOptionsSchema = z.object({
  followUpBehavior: z.enum(['queue', 'steer']).optional(),
  skills: z.array(z.object({ name: z.string().min(1).max(500), path: z.string().min(1).max(4096) }).strict()).max(100).optional(),
  model: z.string().min(1).max(200).nullable().optional(), reasoningEffort: z.string().min(1).max(40).nullable().optional(),
  serviceTier: z.string().min(1).max(80).nullable().optional(), planMode: z.boolean().optional(), inputMethod: z.enum(['typed', 'dictated']).optional(),
  delegation: z.object({ startingContext: z.enum(['conversation', 'handoff']), instructions: z.string().max(100_000).optional() }).strict().optional(),
}).strict();
const reviewSchema = z.object({ target: targetSchema, input: z.object({ scope: z.discriminatedUnion('type', [z.object({ type: z.literal('uncommitted') }).strict(), z.object({ type: z.literal('branch'), baseRef: z.string().min(1).max(200) }).strict()]),
  threadMode: z.enum(['current', 'independent']), instructions: z.string().max(100_000).optional(),
  backend: z.enum(['codex', 'claude', 'antigravity']).optional(), model: identity.optional(), reasoningEffort: z.string().min(1).max(40).optional(),
  automation: z.object({ enabled: z.boolean(), maxPriority: z.enum(['p0', 'p1', 'p2', 'p3']), maxRounds: z.number().int().min(1).max(10), autoCommit: z.boolean().optional() }).strict().optional(),
}).strict().refine(input => input.threadMode === 'independent' || (!input.automation?.enabled && !input.model && !input.reasoningEffort)) }).strict();
/** A branch name git accepts and no option or path trick can hide in. */
const branchName = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((name) => !name.includes('..') && !name.includes('//') && !/[./]$/.test(name) && !name.endsWith('.lock'));
const repositorySchema = z.object({ teamId: identity, repositoryId: identity }).strict();
const newChatSchema = z.object({ teamId: identity, repositoryId: identity, backend: z.enum(['codex', 'claude', 'antigravity']), existingBranch: z.string().min(1).max(1024).optional(), worktree: z.object({ branchName }).strict().optional() }).strict().refine((input) => !(input.existingBranch && input.worktree), 'Choose an existing branch or a new worktree.');
const projectSchema = z.object({ teamId: identity, backend: z.enum(['codex', 'claude', 'antigravity']), source: z.enum(['new', 'local', 'github', 'url']), value: z.string().trim().min(1).max(2000), branch: z.string().min(1).max(1024).optional(), worktree: z.object({ branchName, baseBranch: z.string().min(1).max(1024) }).strict().optional() }).strict().refine(input => {
  if ((input.branch || input.worktree) && !['github', 'local'].includes(input.source)) return false;
  if (input.branch && input.worktree) return false;
  if (input.source === 'new') return input.value !== '.' && input.value !== '..' && !/[/\\\x00-\x1f]/u.test(input.value);
  if (input.source === 'local') return /^\/[a-f0-9]{16}\/[^/]+$/u.test(input.value);
  if (input.source !== 'url') return true;
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/u.test(input.value)) return true;
  try { const url = new URL(input.value); return ['https:', 'ssh:'].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1 && !url.password && (!url.username || url.protocol === 'ssh:'); }
  catch { return false; }
}, 'Invalid project name or repository URL.');
/** A new chat as the laptop runs it: the paths are real, resolved from what the phone named. */
type NewChatRequest = { teamId: string; remoteConnectionId?: string; backend: AgentBackend; repositoryName: string; repositoryRoot: string; defaultBranch?: string; existingBranch?: string; worktree?: { branchName: string } };
type CompanionPromptOptions = z.infer<typeof promptOptionsSchema>;
const maxUploadBytes = companionMaxUploadBytes;
const uploadSchema = z.object({ type: z.enum(['image', 'file']), name: z.string().min(1).max(200), mimeType: z.string().max(120), data: z.string().max(Math.ceil(maxUploadBytes * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict();
const commandSchema = z.object({ target: targetSchema, text: z.string().max(100_000), clientCommandId: z.string().uuid(), options: promptOptionsSchema.optional(), attachments: z.array(uploadSchema).max(companionMaxUploads).optional() }).strict()
  .refine((command) => command.text.length > 0 || (command.attachments?.length ?? 0) > 0, 'A prompt needs text or an attachment.');
export type GatewayState = { push?: Record<string, CompanionPushRegistration>; grants: CompanionGrant[]; commands: Record<string, StoredCommand> };
const commandRetentionMs = 7 * 86_400_000;
export type GatewayPort = {
  gitDiff?(agentId: string, scope: AgentGitDiffTarget): Promise<AgentGitDiff>;
  readImage?(agentId: string, path: string): Promise<import('@workspace/core/companion-protocol').CompanionImage>;
  githubBranches?(repositoryId: string, remoteConnectionId?: string): Promise<CompanionProjectBranch[]>;
  githubRepositories?(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]>;
  localRepositories?(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]>;
  localBranches?(repositoryId: string, remoteConnectionId?: string): Promise<CompanionProjectBranch[]>;
  duplicateAgent?(agentId: string, backend: AgentBackend): Promise<string>;
  renameAgent?(agentId: string, name: string): Promise<void>;
  createProject?(input: CompanionProjectInput, remoteConnectionId: string | undefined, authorize: () => Promise<void>): Promise<string>;
  usage?(): Promise<CompanionUsage[]>;
  push?(peerId: string, registration: CompanionPushRegistration, notification: CompanionNotification): Promise<'sent' | 'invalid' | 'unavailable'>;
  markRead?(agentId: string, revision: number): Promise<void>;
  respondRequest?(response: AgentRequestResponse): Promise<void>;
  onEvent?(listener: (event: AppBackendEvent) => void): () => void;
  workspace(): Promise<CompanionWorkspace>;
  synchronize?(agentId: string, checkpoint: CompanionCheckpoint | null): Promise<CompanionSync>;
  conversation(agentId: string): Promise<CompanionReset>;
  loadOlderHistory(agentId: string): Promise<BackendHistoryLoadResult>;
  readConversationContent?(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk>;
  submit(target: CompanionTarget, text: string, clientId: string, options?: CompanionPromptOptions, uploads?: CompanionUpload[]): Promise<void>;
  models(agentId: string): Promise<unknown[]>;
  plugins?(agentId: string): Promise<BackendPluginSummary[]>;
  skills(agentId: string): Promise<BackendSkillSummary[]>;
  changeGoal?(agentId: string, objective: string | null): Promise<void>;
  updateQueuedPrompt?(target: CompanionTarget, promptId: string, action: 'steer' | 'delete'): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  restart(agentId: string): Promise<void>;
  branches(repositoryRoot: string, remoteConnectionId?: string): Promise<SourceBranch[]>;
  createChat(request: NewChatRequest): Promise<string>;
  createQuickChat(request: { teamId: string; backend: AgentBackend }): Promise<string>;
  setBackend(agentId: string, backend: AgentBackend): Promise<void>;
  closePreview(agentId: string): Promise<Omit<CompanionClosePreview, 'target'>>;
  close(agentId: string, input?: CompanionCloseOptions): Promise<void>;
  setApprovalPreset(agentId: string, preset: string): Promise<void>;
  setPermissionMode(agentId: string, mode: string): Promise<void>;
  startReview(agentId: string, input: z.infer<typeof reviewSchema>['input']): Promise<string | void>;
  reviewSetup?(agentId: string, backend?: AgentBackend): Promise<CompanionReviewSetup>;
  selectModel(agentId: string, selection: { model: string; reasoningEffort: string | null; serviceTier: string | null }): Promise<void>;
  save(state: GatewayState): Promise<void>;
  revoked(peerId: string): void;
};

type CompanionAgent = CompanionWorkspace['agents'][number];
/**
 * An operation on one agent conversation. The dispatcher resolves the target, runs `check`
 * against that same workspace, rechecks the grant and calls `act` with nothing in between:
 * `check` is synchronous by type, and `act` makes its port call before any other await. Reads
 * also recheck target and grant after `act` answers, then `verify` its result against the
 * current agent, so a session switch or revocation during the read cannot answer for it.
 */
type AgentOperation<Input, Result> = {
  parse(args: unknown): { target: CompanionTarget; input: Input };
  check?(agent: CompanionAgent, input: Input, workspace: CompanionWorkspace): undefined;
  act(port: GatewayPort, agent: CompanionAgent, input: Input, target: CompanionTarget): Promise<Result>;
  read?: { verify?(result: Result, current: CompanionAgent, target: CompanionTarget): unknown };
};
/** Curried so the parsed input type is fixed before the handlers are checked against it. */
const agentOperation = <Input>(parse: AgentOperation<Input, unknown>['parse']) => <Result>(operation: Omit<AgentOperation<Input, Result>, 'parse'>) =>
  ({ parse, ...operation }) as unknown as AgentOperation<unknown, unknown>;
const onlyTarget = (args: unknown) => ({ target: targetSchema.parse(args), input: undefined });
const withTarget = <Input>(input: z.ZodType<Input>) => (args: unknown) => {
  const { target, ...rest } = z.looseObject({ target: targetSchema }).parse(args);
  return { target, input: input.parse(rest) };
};
const queuedPromptOperation = (action: 'steer' | 'delete') => agentOperation(withTarget(z.object({ promptId: identity }).strict()))({
  check: (agent, { promptId }, workspace) => {
    if (!workspace.queuedPrompts?.some(prompt => prompt.id === promptId && prompt.agentId === agent.id)) throw new Error('Prompt is no longer queued.');
  },
  act: async (port, _agent, { promptId }, target) => {
    if (!port.updateQueuedPrompt) throw new Error('Queue actions unavailable.');
    await port.updateQueuedPrompt(target, promptId, action); return {};
  },
});
/** Provider snapshots must belong to the agent's current session; Claude and Antigravity can rebind a session id mid-conversation, so their frame is this agent's own replica. */
function currentReset(frame: CompanionReset, current: CompanionAgent, target: CompanionTarget) {
  const session = current.backendSession;
  if (frame.backend !== current.backend || (session?.kind === 'codex' && (frame.type !== 'codex.conversationSnapshotChanged' || frame.threadId !== session.threadId))
    || (session?.kind === 'claude' && frame.type !== 'claude.conversationSnapshotChanged')
    || (session?.kind === 'antigravity' && frame.type !== 'antigravity.conversationSnapshotChanged')) throw new Error('Conversation session mismatch.');
  if (frame.agentId !== target.agentId) throw new Error('Conversation identity mismatch.');
  return frame;
}
/** Every operation a phone may call on an agent; none can bypass the dispatcher's target and grant checks. */
const agentOperations = {
  'agent.git.diff': agentOperation(withTarget(z.object({ scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('uncommitted') }).strict(), z.object({ type: z.literal('unstaged') }).strict(), z.object({ type: z.literal('staged') }).strict(),
    z.object({ type: z.literal('branch'), baseRef: z.string().min(1).max(1024) }).strict(),
    z.object({ type: z.literal('commit'), sha: z.string().regex(/^[a-f0-9]{40,64}$/i) }).strict(),
    z.object({ type: z.literal('turn'), turnId: identity }).strict(),
  ]) }).strict()))({
    check: (agent, { scope }, workspace) => {
      const status = workspace.gitStatuses?.[agent.id];
      if ((scope.type === 'branch' && scope.baseRef !== status?.diffCatalog?.branch?.baseRef)
        || (scope.type === 'commit' && !status?.diffCatalog?.commits.some(commit => commit.sha === scope.sha))
        || (scope.type === 'turn' && scope.turnId !== status?.lastTurn?.turnId)) throw new Error('Git scope is unavailable.');
    },
    act: async (port, agent, { scope }) => {
      if (!port.gitDiff) throw new Error('Git changes unavailable.');
      return port.gitDiff(agent.id, scope);
    }, read: {},
  }),
  'agent.queuedPrompt.steer': queuedPromptOperation('steer'),
  'agent.queuedPrompt.delete': queuedPromptOperation('delete'),
  'conversation.image.read': agentOperation(withTarget(z.object({ path: z.string().min(1).max(4096) }).strict()))({
    act: async (port, agent, { path }, target) => {
      const frame = currentReset(await port.conversation(agent.id), agent, target);
      const reference = conversationImageReference(frame, path);
      if (!port.readImage) throw new Error('Image reading is unavailable.');
      return port.readImage(agent.id, reference);
    },
    read: {},
  }),
  'conversation.read': agentOperation(withTarget(z.object({ revision: z.number().int().nonnegative().safe() }).strict()))({
    act: async (port, agent, { revision }) => {
      if (!port.markRead) throw new Error('Read acknowledgments unavailable.');
      await port.markRead(agent.id, revision); return {};
    },
  }),
  'conversation.subscribe': agentOperation(onlyTarget)({ act: (port, agent) => port.conversation(agent.id), read: { verify: currentReset } }),
  'conversation.synchronize': agentOperation(withTarget(z.object({ checkpoint: z.object({ epoch: z.string().min(1).max(100), revision: z.number().int().nonnegative().safe() }).strict().nullable() }).strict()))({
    act: (port, agent, { checkpoint }) => {
      if (!port.synchronize) throw new Error('Conversation synchronization unavailable.');
      return port.synchronize(agent.id, checkpoint);
    },
    read: { verify: (result, current, target) => {
      for (const frame of result.frames) {
        if (isConversationReset(frame)) currentReset(frame as CompanionReset, current, target);
        else if (frame.agentId !== target.agentId || frame.backend !== current.backend || (current.backendSession?.kind === 'codex' && frame.threadId !== current.backendSession.threadId)) throw new Error('Conversation session mismatch.');
      }
      return result;
    } },
  }),
  'conversation.loadOlder': agentOperation(onlyTarget)({
    act: async (port, agent) => {
      const page = await port.loadOlderHistory(agent.id);
      return { page, reset: page.frame ? undefined : await port.conversation(agent.id) };
    },
    read: { verify: ({ page, reset }, current, target) => {
      if (reset) return { frame: currentReset(reset, current, target), hasOlder: page.hasOlder };
      if (!page.frame || page.frame.agentId !== target.agentId || current.backendSession?.kind !== 'claude'
        || page.frame.payload.event.backendSessionId !== current.backendSession.sessionId
        || page.frame.payload.event.type !== 'history.prepended') throw new Error('Conversation identity mismatch.');
      return { frame: page.frame, hasOlder: page.hasOlder };
    } },
  }),
  'conversation.content.read': agentOperation(withTarget(z.object({ input: z.object({ sessionId: identity, contentId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().nonnegative().safe() }).strict() }).strict()))({
    check: (agent, { input }) => {
      if (agent.backendSession?.kind !== 'claude' || agent.backendSession.sessionId !== input.sessionId) throw new Error('Conversation content is unavailable.');
    },
    act: async (port, agent, { input }) => {
      if (!port.readConversationContent) throw new Error('Conversation content is unavailable.');
      return port.readConversationContent(agent.id, input);
    },
    read: {},
  }),
  'agent.request.respond': agentOperation(withTarget(z.object({ id: identity, conversationId: z.string().min(1).max(500), outcome: requestOutcomeSchema }).strict()))({
    check: (agent, reply, workspace) => {
      if (!workspace.agentRequests?.[agent.id]?.some((request) => request.id === reply.id && request.conversationId === reply.conversationId)) throw new Error('Request is no longer pending.');
    },
    // The daemon request owner validates decision scopes and consumes the pending request.
    act: async (port, agent, { id, outcome }) => {
      if (!port.respondRequest) throw new Error('Request is no longer pending.');
      await port.respondRequest({ agentId: agent.id, id, outcome }); return {};
    },
  }),
  'skills.list': agentOperation(onlyTarget)({ act: async (port, agent) => ({ skills: await port.skills(agent.id) }), read: {} }),
  'plugins.list': agentOperation(onlyTarget)({ act: async (port, agent) => ({ plugins: await port.plugins?.(agent.id) ?? [] }), read: {} }),
  'models.list': agentOperation(onlyTarget)({ act: async (port, agent) => ({ models: await port.models(agent.id) }), read: {} }),
  'agent.model.select': agentOperation(withTarget(z.object({ model: z.string().min(1).max(200), reasoningEffort: z.string().min(1).max(40).nullable(), serviceTier: z.string().min(1).max(80).nullable() }).strict()))({
    act: async (port, agent, selection) => { await port.selectModel(agent.id, selection); return {}; },
  }),
  'agent.interrupt': agentOperation(onlyTarget)({ act: async (port, agent) => { await port.interrupt(agent.id); return {}; } }),
  'agent.approvalPreset.set': agentOperation(withTarget(z.object({ preset: z.string().min(1).max(40) }).strict()))({
    act: async (port, agent, { preset }) => { await port.setApprovalPreset(agent.id, preset); return {}; },
  }),
  'agent.permissionMode.set': agentOperation(withTarget(z.object({ mode: z.string().min(1).max(80) }).strict()))({
    act: async (port, agent, { mode }) => { await port.setPermissionMode(agent.id, mode); return {}; },
  }),
  'agent.goal.set': agentOperation(withTarget(z.object({ objective: z.string().trim().min(1).max(100_000).nullable() }).strict()))({
    check: (agent) => { if (!defaultBackendCapabilities(agent.backend).goals) throw new Error('Goals unavailable.'); },
    act: async (port, agent, { objective }) => {
      if (!port.changeGoal) throw new Error('Goals unavailable.');
      await port.changeGoal(agent.id, objective); return {};
    },
  }),
  'agent.backend.set': agentOperation(withTarget(z.object({ backend: z.enum(['codex', 'claude', 'antigravity']) }).strict()))({
    check: (agent, { backend }, { backends }) => {
      if (!canSelectAgentBackend(agent)) throw new Error('The engine can only change before the first prompt.');
      if (backends && !backends[agent.teamId ?? '']?.includes(backend)) throw new Error('That engine is not available.');
    },
    act: async (port, agent, { backend }) => { await port.setBackend(agent.id, backend); return {}; },
  }),
  'agent.rename': agentOperation(withTarget(z.object({ name: z.string().trim().min(1).max(200) }).strict()))({
    act: async (port, agent, { name }) => {
      if (!port.renameAgent) throw new Error('Agent renaming is unavailable.');
      await port.renameAgent(agent.id, name); return {};
    },
  }),
  'agent.duplicate': agentOperation(withTarget(z.object({ backend: z.enum(['codex', 'claude', 'antigravity']) }).strict()))({
    check: (agent, { backend }, { backends }) => {
      if (!backends?.[agent.teamId ?? '']?.includes(backend)) throw new Error('That engine is not available.');
    },
    act: async (port, agent, { backend }) => {
      if (!port.duplicateAgent) throw new Error('Agent duplication is unavailable.');
      return { agentId: await port.duplicateAgent(agent.id, backend) };
    },
  }),
  'agent.restart': agentOperation(onlyTarget)({
    check: (agent) => { if (agent.status.type === 'working' || agent.status.type === 'awaitingInput') throw new Error('Stop the agent before restarting.'); },
    act: async (port, agent) => { await port.restart(agent.id); return {}; },
  }),
  'agent.close.preview': agentOperation(onlyTarget)({ act: async (port, agent, _input, target) => ({ ...await port.closePreview(agent.id), target }), read: {} }),
  'agent.close': agentOperation(withTarget(z.object({ input: closeInputSchema.optional() }).strict()))({
    act: async (port, agent, { input }) => { await port.close(agent.id, input); return {}; },
  }),
  'agent.review.setup': agentOperation(withTarget(z.object({ backend: z.enum(['codex', 'claude', 'antigravity']).optional() }).strict()))({
    act: async (port, agent, { backend }) => {
      if (!port.reviewSetup) throw new Error('Review setup unavailable.');
      return port.reviewSetup(agent.id, backend);
    },
    read: {},
  }),
  'agent.review.start': agentOperation((args) => reviewSchema.parse(args))({
    act: async (port, agent, input) => ({ reviewerAgentId: await port.startReview(agent.id, input) ?? null }),
  }),
} satisfies Record<string, AgentOperation<unknown, unknown>>;
export const companionAgentMethods = Object.keys(agentOperations);
type Peer = { peerId: string; grant: CompanionGrant };
type Operation = (peer: Peer, args: unknown) => Promise<unknown>;

/** Peer identity is supplied exclusively by the authenticated Noise connection. */
export class CompanionGateway {
  /** Full codes are temporary invitations, never durable credentials or encryption keys. */
  private readonly invitations = new Map<string, { code: string; expiresAt: number; pendingId?: string }>();
  private readonly pending = new Map<string, CompanionPending & { code: string }>();
  private readonly notifications = new Set<(notification: CompanionNotification) => void>();
  private readonly livePhones = new Map<string, Set<CompanionSubscription>>();
  private mutations = Promise.resolve();
  private readonly creations = new ChatCreations();
  private readonly ledger = new CommandLedger((key) => this.state.commands[key]);
  private readonly pairingAttempts: WindowBudget;
  constructor(readonly hostId: string, private state: GatewayState, private readonly port: GatewayPort, private readonly now = Date.now, private readonly autoAcceptCode?: string) {
    this.pairingAttempts = new WindowBudget(10, pairingLifetimeMs, 200, now);
  }
  get grants() { return this.state.grants.map((grant) => ({ ...grant })); }
  get pendingRequests() { this.expire(); return [...this.pending.values()].map(({ code: _code, ...pending }) => pending); }
  /** Advertise each original expiry; refreshing the relay never extends an invitation. */
  pairingInvitations() { this.expire(); return [...this.invitations.values()].map(({ code, expiresAt }) => ({ code, expiresAt })); }
  invite() {
    this.expire();
    if (this.invitations.size >= companionMaxInvitations) throw new Error('Too many active invitations.');
    let code = generatePairingCode();
    while (this.invitations.has(normalizePairingCode(code)!)) code = generatePairingCode();
    const expiresAt = this.now() + pairingLifetimeMs;
    this.invitations.set(normalizePairingCode(code)!, { code: normalizePairingCode(code)!, expiresAt });
    return { code, expiresAt };
  }
  discardInvitation(shown: string) {
    const code = normalizePairingCode(shown);
    if (!code) return;
    const invitation = this.invitations.get(code);
    if (invitation?.pendingId) this.pending.delete(invitation.pendingId);
    this.invitations.delete(code);
  }
  /** Approval grants everything: every team, reading and sending. The desktop decides per device, not per scope. */
  async decide(id: string, approve: boolean) {
    return this.mutate(async () => {
      this.expire();
      const pending = this.pending.get(id);
      if (!pending) throw new Error('Pairing request expired or consumed.');
      if (approve && this.state.grants.length >= companionMaxDevices && !this.state.grants.some((grant) => grant.peerId === pending.peerId)) throw new Error('Too many paired devices.');
      const next = { ...this.state, grants: this.state.grants.filter((grant) => grant.peerId !== pending.peerId) };
      if (approve) next.grants.push({ peerId: pending.peerId, name: pending.name, createdAt: this.now() });
      await this.port.save(next);
      this.state = next;
      this.pending.delete(id); this.invitations.delete(pending.code);
    });
  }
  async notify(notification: CompanionNotification, allowPush: () => Promise<boolean> = async () => true) {
    for (const listener of this.notifications) listener(notification);
    if (!await allowPush()) return;
    await Promise.all(this.state.grants.map(async grant => {
      const registration = this.state.push?.[grant.peerId];
      if (!registration || !this.port.push || [...this.livePhones.get(grant.peerId) ?? []].some(subscription => subscription.foreground)) return;
      const result = await this.port.push(grant.peerId, registration, notification).catch(() => 'unavailable');
      if (result === 'invalid') await this.mutate(async () => {
        if (this.state.push?.[grant.peerId] !== registration) return;
        const push = { ...this.state.push }; delete push[grant.peerId];
        const next = { ...this.state, push }; await this.port.save(next); this.state = next;
      });
    }));
  }
  async revoke(peerId: string) {
    return this.mutate(async () => {
      const push = { ...this.state.push }; delete push[peerId];
      const commands = Object.fromEntries(Object.entries(this.state.commands).filter(([key]) => !key.startsWith(`${peerId}:`)));
      const next = { ...this.state, push, commands, grants: this.state.grants.filter((grant) => grant.peerId !== peerId) };
      await this.port.save(next); this.state = next;
      this.port.revoked(peerId);
    });
  }
  subscribe(peerId: string, emit: ConstructorParameters<typeof CompanionSubscription>[1], fail: () => void) {
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (!grant || !this.port.onEvent) throw new Error('Device is not authorized for updates.');
    const subscriptions = this.livePhones.get(peerId) ?? new Set<CompanionSubscription>();
    this.livePhones.set(peerId, subscriptions);
    const subscription = new CompanionSubscription({
      onClose: () => { subscriptions.delete(subscription); if (!subscriptions.size) this.livePhones.delete(peerId); },
      authorized: () => this.state.grants.includes(grant),
      onNotification: listener => { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; },
      onEvent: (listener) => this.port.onEvent!(listener),
      request: (method, args) => this.request(peerId, method, args),
    }, emit, fail, this.now);
    subscriptions.add(subscription);
    return subscription;
  }
  async request(peerId: string, method: string, args: unknown): Promise<unknown> {
    this.expire();
    if (method === 'pair.claim') return this.claim(peerId, args);
    if (method === 'pair.status') return this.pairStatus(peerId, args);
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (!grant) throw new Error('Device is not authorized.');
    // Own properties only: a phone-supplied name must never resolve an inherited member.
    if (Object.hasOwn(agentOperations, method)) return this.runAgentOperation({ peerId, grant }, agentOperations[method as keyof typeof agentOperations], args);
    const operation = Object.hasOwn(this.operations, method) ? this.operations[method] : undefined;
    if (!operation) throw new Error('Companion operation is not supported.');
    return operation({ peerId, grant }, args);
  }
  /**
   * Operations that are not bound to one agent conversation. Anything taking a target belongs in
   * `agentOperations`; prompt admission is the exception, owned by `CommandLedger` and validated
   * inside the mutation lock.
   */
  private readonly operations: Record<string, Operation> = {
    'project.local.list': async (peer, args) => {
      const { teamId } = z.object({ teamId: identity }).strict().parse(args);
      if (!this.port.localRepositories) throw new Error('Repositories are unavailable.');
      return this.projectRead(peer, teamId, remote => this.port.localRepositories!(remote));
    },
    'project.local.branches': async (peer, args) => {
      const { teamId, repositoryId } = repositorySchema.parse(args);
      if (!this.port.localBranches) throw new Error('Branches are unavailable.');
      return this.projectRead(peer, teamId, remote => this.port.localBranches!(repositoryId, remote));
    },
    'project.github.list': async (peer, args) => {
      const { teamId } = z.object({ teamId: identity }).strict().parse(args);
      if (!this.port.githubRepositories) throw new Error('GitHub repositories are unavailable.');
      return this.projectRead(peer, teamId, remote => this.port.githubRepositories!(remote));
    },
    'project.github.branches': async (peer, args) => {
      const { teamId, repositoryId } = repositorySchema.parse(args);
      if (!this.port.githubBranches) throw new Error('GitHub branches are unavailable.');
      return this.projectRead(peer, teamId, remote => this.port.githubBranches!(repositoryId, remote));
    },
    'project.create': async (peer, args) => {
      const input = projectSchema.parse(args);
      const workspace = await this.port.workspace();
      const team = workspace.teams.find(team => team.id === input.teamId);
      this.requireGrant(peer);
      if (!team) throw new Error('Team not found.');
      const authorize = async () => {
        const current = await this.port.workspace();
        this.requireGrant(peer);
        if (!current.teams.some(candidate => candidate.id === team.id && candidate.remoteConnectionId === team.remoteConnectionId)) throw new Error('Team changed.');
        if (!current.backends?.[team.id]?.includes(input.backend)) throw new Error('That engine is not available.');
      };
      await authorize();
      if (!this.port.createProject) throw new Error('Project creation is unavailable.');
      return { creationId: this.creations.start(peer.peerId, () => this.port.createProject!(input, team.remoteConnectionId, authorize)) };
    },
    'usage.get': async (peer, args) => {
      z.object({}).strict().parse(args);
      if (!this.port.usage) throw new Error('Usage is unavailable.');
      const usage = await this.port.usage();
      this.requireGrant(peer);
      return usage;
    },
    'notifications.register': async (peer, args) => {
      const registration = pushRegistrationSchema.nullable().parse(args);
      await this.mutate(async () => {
        this.requireGrant(peer);
        const push = { ...this.state.push };
        if (registration) push[peer.peerId] = registration; else delete push[peer.peerId];
        const next = { ...this.state, push }; await this.port.save(next); this.state = next;
      });
      return {};
    },
    'snapshot.get': async (peer, args) => {
      const { iconsVersion } = z.object({ iconsVersion: z.string().max(64).optional(), notifications: z.boolean().optional() }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peer);
      const { repositoryIcons, ...projected } = projectCompanionWorkspace(workspace);
      // Icons are large and rarely change: send them only when the phone's copy is out of date.
      const version = createHash('sha256').update(JSON.stringify(Object.entries(repositoryIcons).sort())).digest('hex').slice(0, 16);
      return { ...projected, ...(this.port.synchronize ? { conversationSync: true } : {}), iconsVersion: version, ...(version === iconsVersion ? {} : { repositoryIcons }) };
    },
    'prompt.submit': (peer, args) => {
      const command = commandSchema.parse(args);
      const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
      const key = `${peer.peerId}:${command.clientCommandId}`;
      return this.ledger.submit(key, fingerprint, command.target, () => this.admit(peer, key, command, fingerprint));
    },
    'command.status': async (peer, args) => {
      const { clientCommandId } = z.object({ clientCommandId: z.string().uuid() }).strict().parse(args);
      return this.ledger.status(`${peer.peerId}:${clientCommandId}`, clientCommandId);
    },
    'repository.branches': async (peer, args) => {
      const input = repositorySchema.parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peer);
      const { team, repository } = this.repository(workspace, input);
      const branches = await this.port.branches(repository.primaryWorktreeRoot, team.remoteConnectionId);
      this.requireGrant(peer);
      return branches.map(({ name, isDefault, worktreePath }) => ({ name, isDefault, isCheckedOut: Boolean(worktreePath) }));
    },
    'agent.create': async (peer, args) => {
      const input = newChatSchema.parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peer);
      const { team, repository } = this.repository(workspace, input);
      if (workspace.backends && !workspace.backends[team.id]?.includes(input.backend)) throw new Error('That engine is not available.');
      const request: NewChatRequest = { teamId: team.id, ...(team.remoteConnectionId ? { remoteConnectionId: team.remoteConnectionId } : {}), backend: input.backend,
        repositoryName: repository.repositoryName, repositoryRoot: repository.primaryWorktreeRoot, ...(repository.defaultBranch ? { defaultBranch: repository.defaultBranch } : {}),
        ...(input.existingBranch ? { existingBranch: input.existingBranch } : {}), ...(input.worktree ? { worktree: input.worktree } : {}) };
      return { creationId: this.creations.start(peer.peerId, () => this.port.createChat(request)) };
    },
    'agent.quickChat.create': async (peer, args) => {
      const input = z.object({ teamId: identity, backend: z.enum(['codex', 'claude', 'antigravity']) }).strict().parse(args);
      const workspace = await this.port.workspace();
      this.requireGrant(peer);
      if (!workspace.teams.some((team) => team.id === input.teamId)) throw new Error('Team not found.');
      if (workspace.backends && !workspace.backends[input.teamId]?.includes(input.backend)) throw new Error('That engine is not available.');
      return { creationId: this.creations.start(peer.peerId, () => this.port.createQuickChat(input)) };
    },
    'agent.create.status': async (peer, args) => {
      const { creationId } = z.object({ creationId: z.string().uuid() }).strict().parse(args);
      return this.creations.status(peer.peerId, creationId);
    },
    'device.forget': async (peer, args) => { z.object({}).strict().parse(args); await this.revoke(peer.peerId); return {}; },
  };
  private claim(peerId: string, args: unknown) {
    const request = z.object({ code: z.string().length(8), name: z.string().trim().min(1).max(80) }).strict().parse(args);
    if (!this.pairingAttempts.take(peerId)) throw new Error('Too many pairing attempts.');
    if (request.code === this.autoAcceptCode) return this.mutate(async () => {
      if (!this.state.grants.some(grant => grant.peerId === peerId)) {
        if (this.state.grants.length >= companionMaxDevices) throw new Error('Too many paired devices.');
        const grant = { peerId, name: request.name, createdAt: this.now() };
        const next = { ...this.state, grants: [...this.state.grants, grant] };
        await this.port.save(next);
        this.state = next;
      }
      return { pendingId: randomUUID(), state: 'approved' };
    });
    const invitation = this.invitations.get(request.code);
    if (!invitation) throw new Error('Invalid or expired invitation.');
    if (invitation.pendingId) {
      const pending = this.pending.get(invitation.pendingId);
      if (pending?.peerId === peerId) return { pendingId: pending.id, state: 'awaitingApproval' };
      throw new Error('Invitation already claimed.');
    }
    if (this.state.grants.some(grant => grant.peerId === peerId)) {
      this.invitations.delete(request.code);
      return { pendingId: randomUUID(), state: 'approved' };
    }
    // No await between checking and consuming: only this authenticated peer may await approval.
    const id = randomUUID();
    invitation.pendingId = id;
    this.pending.set(id, { id, peerId, name: request.name, code: request.code, expiresAt: invitation.expiresAt });
    return { pendingId: id, state: 'awaitingApproval' };
  }
  private pairStatus(peerId: string, args: unknown) {
    const { pendingId } = z.object({ pendingId: z.string().uuid() }).strict().parse(args);
    const grant = this.state.grants.find((grant) => grant.peerId === peerId);
    if (grant) return { state: 'approved', grant };
    const pending = this.pending.get(pendingId);
    if (!pending || pending.peerId !== peerId) throw new Error('Pairing denied or expired.');
    return { state: 'awaitingApproval' };
  }
  /** Validates and persists a pending receipt before the provider sees the prompt; provider admission runs outside the mutation lock. */
  private async admit(peer: Peer, key: string, command: z.infer<typeof commandSchema>, fingerprint: string): Promise<SettledCommand> {
    const { pending, uploads } = await this.mutate(async () => {
      this.requireGrant(peer);
      const agent = await this.validateTarget(command.target);
      if (command.options?.skills?.length) {
        const catalog = await this.port.skills(agent.id);
        if (command.options.skills.some((selected) => !catalog.some((skill) => skill.enabled && skill.name === selected.name && skill.path === selected.path))) throw new Error('Skill is unavailable.');
        const current = await this.validateTarget(command.target);
        if (current.backend !== agent.backend || current.folder !== agent.folder) throw new Error('Target is stale.');
        this.requireGrant(peer);
      }
      if (command.attachments?.length && command.target.locationId !== 'local') throw new Error('Remote attachments require a trusted file transfer.');
      const uploads = command.attachments?.length ? command.attachments.map((upload) => ({ ...upload, data: Buffer.from(upload.data, 'base64') })) : undefined;
      if (uploads && (uploads.reduce((total, upload) => total + upload.data.byteLength, 0) > maxUploadBytes || uploads.some((upload, index) => upload.data.toString('base64') !== command.attachments![index]!.data))) throw new Error('Attachment too large.');
      const commands = this.liveCommands();
      if (Object.keys(commands).length >= 10_000) throw new Error('Command receipt storage is full.');
      const pending: StoredCommand = { clientCommandId: command.clientCommandId, state: 'pending', target: command.target, fingerprint, createdAt: this.now() };
      const next = { ...this.state, commands: { ...commands, [key]: pending } };
      await this.port.save(next); this.state = next;
      return { pending, uploads };
    });
    let state: SettledCommand['state'] = 'unresolved';
    const client = `mobile:${peer.peerId}`;
    try { await (uploads ? this.port.submit(command.target, command.text, client, command.options, uploads) : this.port.submit(command.target, command.text, client, command.options)); state = 'accepted'; }
    catch (error) { if (error instanceof PromptRejectedError) state = 'rejected'; }
    const completed = { ...pending, state };
    // A device revoked during admission has no ledger left to complete; a failed save leaves the receipt unresolved.
    await this.mutate(async () => {
      if (!this.state.commands[key]) return;
      const saved = { ...this.state, commands: { ...this.state.commands, [key]: completed } };
      await this.port.save(saved); this.state = saved;
    }).catch(() => {});
    return completed;
  }
  private async runAgentOperation(peer: Peer, operation: AgentOperation<unknown, unknown>, args: unknown) {
    const { target, input } = operation.parse(args);
    const { agent, workspace } = await this.resolveTarget(target);
    operation.check?.(agent, input, workspace);
    this.requireGrant(peer);
    const result = await operation.act(this.port, agent, input, target);
    if (!operation.read) return result;
    const current = await this.validateTarget(target);
    this.requireGrant(peer);
    if (current.backend !== agent.backend || current.folder !== agent.folder) throw new Error('Target is stale.');
    return operation.read.verify ? operation.read.verify(result, current, target) : result;
  }
  private repository(workspace: CompanionWorkspace, input: { teamId: string; repositoryId: string }) {
    const team = workspace.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) throw new Error('Team not found.');
    const repository = workspace.agents.flatMap((agent) => agent.teamId === team.id && agent.sessionKind !== 'quickChat' && agent.workspace?.kind === 'git' && opaquePath(agent.workspace.primaryWorktreeRoot) === input.repositoryId ? [agent.workspace] : [])[0];
    if (!repository) throw new Error('Repository not found.');
    return { team, repository };
  }
  private async projectRead<Result>(peer: Peer, teamId: string, read: (remoteConnectionId?: string) => Promise<Result>): Promise<Result> {
    const workspace = await this.port.workspace();
    this.requireGrant(peer);
    const team = workspace.teams.find(team => team.id === teamId);
    if (!team) throw new Error('Team not found.');
    const remote = team.remoteConnectionId;
    const result = await read(remote);
    const current = await this.port.workspace();
    this.requireGrant(peer);
    if (!current.teams.some(candidate => candidate.id === teamId && candidate.remoteConnectionId === remote)) throw new Error('Team changed.');
    return result;
  }
  private requireGrant({ peerId, grant }: Peer) {
    if (this.state.grants.find((current) => current.peerId === peerId) !== grant) throw new Error('Device is not authorized.');
  }
  private async validateTarget(target: CompanionTarget) { return (await this.resolveTarget(target)).agent; }
  private async resolveTarget(target: CompanionTarget) {
    const workspace = await this.port.workspace();
    const team = workspace.teams.find((team) => team.id === target.teamId);
    const agent = workspace.agents.find((agent) => agent.id === target.agentId && agent.teamId === target.teamId);
    if (target.hostId !== this.hostId || !team || !agent
      || target.locationId !== (team.remoteConnectionId ?? 'local') || target.sessionId !== companionSessionId(agent)) throw new Error('Target is stale.');
    return { agent, workspace };
  }
  /** Drops expired receipts and those of devices that are no longer paired. */
  private liveCommands(): GatewayState['commands'] {
    const now = this.now();
    const live: GatewayState['commands'] = {};
    for (const [key, command] of Object.entries(this.state.commands)) {
      const createdAt = command.createdAt ?? now;
      if (now - createdAt > commandRetentionMs || !this.state.grants.some((grant) => key.startsWith(`${grant.peerId}:`))) continue;
      live[key] = command.createdAt === undefined ? { ...command, createdAt } : command;
    }
    return live;
  }
  private mutate<Result>(action: () => Promise<Result>): Promise<Result> {
    const pending = this.mutations.then(action);
    this.mutations = pending.then(() => {}, () => {});
    return pending;
  }
  private expire() {
    for (const [id, invitation] of this.invitations) if (invitation.expiresAt <= this.now()) {
      if (invitation.pendingId) this.pending.delete(invitation.pendingId);
      this.invitations.delete(id);
    }
  }
}
