import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizePromptContent, promptContentText } from '@codex-app-sdk/core/surface';
import type { Agent, BackendSession, SendPromptOptions } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { cursorBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import type { ExecutionObservation } from '@workspace/core/usage';
import type { BackendDriverRegistryOptions } from '../driver-rpc';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { backendHomeDir } from '../state';
import { CursorAuthentication } from './authentication';
import { cursorHome, resolveCursorExecutable } from './runtime';
import { CursorSession } from './session';

export class CursorHost implements AgentBackendDriver {
  readonly backend = 'cursor' as const;
  private readonly sessions = new Map<string, CursorSession>();
  private readonly opening = new Map<string, { abort: AbortController; done: Promise<CursorSession> }>();
  private readonly generations = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly usageListeners = new Set<(event: ExecutionObservation) => void>();
  private closed = false;
  private checking?: ReturnType<CursorAuthentication['authenticate']>;
  private readonly authentication = new CursorAuthentication(payload => this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload }));
  constructor(private readonly options: BackendDriverRegistryOptions = {}) {}
  authenticate(request: Parameters<CursorAuthentication['authenticate']>[0]) {
    if (request.action !== 'check') return this.authentication.authenticate(request);
    if (this.checking) return this.checking;
    const checking = this.authentication.authenticate(request).finally(() => { if (this.checking === checking) this.checking = undefined; });
    this.checking = checking; return checking;
  }
  getRuntimeStatus() {
    const live = [...this.sessions.values()].some(session => !session.isClosed);
    return { backend: this.backend, status: !resolveCursorExecutable() ? 'notConfigured' as const : live ? 'running' as const : this.sessions.size ? 'error' as const : 'starting' as const };
  }
  getCapabilities() { return cursorBackendCapabilities; }
  onEvent(listener: (event: BackendEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onUsage(listener: (event: ExecutionObservation) => void) { this.usageListeners.add(listener); return () => { this.usageListeners.delete(listener); }; }
  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    if (agent.backend !== this.backend || (agent.backendSession && agent.backendSession.kind !== this.backend)) throw new Error('Cursor cannot use another provider conversation.');
    if (options?.attachments?.length || options?.planMode || options?.selection?.model || options?.backendOptions) throw new Error('Cursor attachments, model and mode controls are not available yet.');
    const generation = this.generations.get(agent.id) ?? 0;
    const previous = this.queues.get(agent.id);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(agent.id, pending);
    const settle = () => { release(); if (this.queues.get(agent.id) === pending) this.queues.delete(agent.id); };
    try {
      await previous;
      if (this.closed || generation !== (this.generations.get(agent.id) ?? 0)) throw new Error('Cursor conversation was released before admission.');
      const session = await this.ensure(agent);
      const content = options?.content === undefined ? undefined : normalizePromptContent(options.content);
      const instructions = appDeveloperInstructions(agent, this.options.pluginSettings?.(), {
        celebrationsEnabled: this.options.celebrationsEnabled?.(), developerInstructions: this.options.additionalDeveloperInstructions?.(agent),
      });
      const wire = `${promptWithSelectedReferences(prompt, content)}\n\n<context id="${randomUUID()}">\n${instructions}\n</context>`;
      const turn = session.prompt(content === undefined ? prompt : promptContentText(content), wire, content === undefined ? undefined : { promptContent: content });
      void turn.completion.finally(settle);
      return { backendSession: this.reference(session), turnId: turn.turnId };
    } catch (error) { settle(); throw error; }
  }
  async interrupt(agent: Agent, expectedTurnId?: string) {
    const session = this.sessions.get(agent.id);
    if (!session) throw new Error('Cursor session is not running.');
    const turnId = session.snapshot.activeTurnId ?? undefined;
    await session.interrupt(expectedTurnId);
    return { backendSession: this.reference(session), turnId };
  }
  async respondToAgentRequest(): Promise<void> { throw new Error('Cursor permissions and questions are not available yet.'); }
  async loadConversation(agent: Agent): Promise<BackendSession | null> {
    const current = this.sessions.get(agent.id);
    if (!current) { if (agent.backendSession) throw new Error('Cursor history resume is not available yet.'); return null; }
    if (agent.backendSession && (agent.backendSession.kind !== this.backend || agent.backendSession.sessionId !== current.sessionId)) throw new Error('Cursor conversation identity mismatch.');
    this.publishSnapshot(agent.id, current);
    return this.reference(current);
  }
  async assertHandoffReady(agent: Agent): Promise<void> {
    if (this.queues.has(agent.id) || this.opening.has(agent.id)) throw new Error('Finish the current Cursor operation first.');
  }
  async releaseConversation(agentId: string): Promise<void> {
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
    this.opening.get(agentId)?.abort.abort();
    const session = this.sessions.get(agentId);
    await session?.close();
    if (this.sessions.get(agentId) === session) this.sessions.delete(agentId);
    await this.opening.get(agentId)?.done.catch(() => {});
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const opening of this.opening.values()) opening.abort.abort();
    await this.authentication.close();
    await Promise.all([...this.sessions.keys()].map(id => this.releaseConversation(id)));
    await Promise.allSettled([...this.opening.values()].map(value => value.done));
    await Promise.allSettled(this.queues.values());
    this.listeners.clear();
    this.usageListeners.clear();
  }
  private async ensure(agent: Agent): Promise<CursorSession> {
    const current = this.sessions.get(agent.id);
    if (current) {
      if (current.isClosed) throw new Error('Cursor connection closed. Reconnect in Settings; history resume is not available yet.');
      if (agent.backendSession && (agent.backendSession.kind !== this.backend || agent.backendSession.sessionId !== current.sessionId)) throw new Error('Cursor conversation identity mismatch.');
      if (agent.folder && path.resolve(agent.folder) !== path.resolve(current.cwd)) throw new Error('Cursor conversation belongs to another workspace.');
      return current;
    }
    if (agent.backendSession) throw new Error('Cursor history resume is not available yet.');
    const existing = this.opening.get(agent.id); if (existing) return existing.done;
    const generation = this.generations.get(agent.id) ?? 0;
    const abort = new AbortController();
    const done = (async () => {
      const auth = await this.authenticate({ action: 'check' });
      if (!auth.connected) throw new Error(auth.state.error ?? 'Cursor is disconnected. Sign in in Settings.');
      const cwd = agent.folder ?? path.join(backendHomeDir(), 'cursor-quick-chats', encodeURIComponent(agent.id));
      if (!agent.folder) await mkdir(cwd, { recursive: true, mode: 0o700 });
      const session = await CursorSession.open({ agentId: agent.id, cwd, signal: abort.signal,
        changed: event => this.conversationEvent(event), disconnected: error => this.disconnected(error),
      });
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await session.close(); throw new Error('Cursor session was released during startup.'); }
      this.sessions.set(agent.id, session); this.publishSnapshot(agent.id, session); return session;
    })().catch(error => { this.disconnected(error instanceof Error ? error : new Error('Cursor session failed.')); throw error; }).finally(() => this.opening.delete(agent.id));
    this.opening.set(agent.id, { abort, done }); return done;
  }
  private disconnected(error: Error): void {
    this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload: { kind: this.backend, connected: false, state: { loggedIn: false, homePath: cursorHome(), error: error.message } } });
  }
  private conversationEvent(event: CursorConversationEvent): void {
    const current = this.sessions.get(event.agentId);
    if (current?.sessionId !== event.sessionId) return;
    if (this.closed) {
      if (event.type === 'turn.completed') this.observeUsage(event, event.payload.turn.status);
      return;
    }
    const identity = { backend: this.backend, agentId: event.agentId, backendSessionId: event.sessionId, conversationId: event.sessionId, turnId: event.turnId };
    // Start before transcript output reaches the daemon clock, finish after its
    // terminal events. Snapshot reads and replay never produce observations.
    if (event.type === 'turn.started') this.observeUsage(event, 'started');
    this.emit({ ...identity, type: 'cursor.conversationEventReceived', payload: { revision: this.nextRevision(event.agentId), event } });
    if (event.type === 'turn.started') this.emit({ ...identity, type: 'agent.statusChanged', payload: { type: 'working' } });
    if (event.type === 'turn.completed') this.emit({ ...identity, type: 'agent.statusChanged', payload: event.payload.turn.status === 'failed' ? { type: 'error', message: event.payload.error ?? 'Cursor turn failed.' } : { type: 'idle' } });
    if (event.type === 'turn.completed') this.observeUsage(event, event.payload.turn.status);
  }
  private observeUsage(event: CursorConversationEvent, phase: ExecutionObservation['phase']): void {
    const turn = this.sessions.get(event.agentId)?.snapshot.turns.find(turn => turn.id === event.turnId);
    const observation: ExecutionObservation = {
      provider: this.backend, agentId: event.agentId, sessionId: event.sessionId, turnId: event.turnId,
      phase, at: Date.parse(event.occurredAt), model: null, tokens: null,
      ...(phase !== 'started' && turn?.durationMs != null ? { durationMs: turn.durationMs } : {}),
    };
    for (const listener of this.usageListeners) { try { listener(observation); } catch { /* Observer isolation. */ } }
  }
  private publishSnapshot(agentId: string, session: CursorSession): void {
    this.emit({ backend: this.backend, agentId, backendSessionId: session.sessionId, conversationId: session.sessionId,
      type: 'cursor.conversationSnapshotChanged', payload: { revision: this.nextRevision(agentId), snapshot: structuredClone(session.snapshot) } });
  }
  private reference(session: CursorSession): BackendSession { return { kind: this.backend, sessionId: session.sessionId }; }
  private nextRevision(agentId: string) { const revision = (this.revisions.get(agentId) ?? 0) + 1; this.revisions.set(agentId, revision); return revision; }
  private emit(event: BackendEvent) { for (const listener of this.listeners) { try { listener(event); } catch { /* Observer isolation. */ } } }
}
