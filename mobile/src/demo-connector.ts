import type { Agent } from '@workspace/core/contracts';
import type { CodexConversationSnapshot, SurfaceMessage } from '@codex-app-sdk/core/surface';
import type { CompanionConnector, CompanionSession } from './companion-port';

/** Explicit offline demo; no daemon, network, credentials or provider execution. */
export function createDemoConnector(): CompanionConnector {
  const agents: Agent[] = ['demo-agent', 'demo-reviewer'].map((id, index) => ({
    id, teamId: 'demo-team', name: index ? 'Reviewer' : 'Builder', folder: null,
    backend: 'codex', status: { type: 'idle' },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  const messages = new Map<string, SurfaceMessage[]>(agents.map((agent) => [agent.id, [textMessage(
    `welcome-${agent.id}`, 'assistant', 'The companion is ready. This is a local demo conversation. Prompts stay on this device.',
  )]]));
  const sessions = new Set<{ close(): void }>();
  let sequence = 0;
  const requireLaptop = (id: string) => {
    if (id !== 'demo-laptop') throw new Error('Unknown demo laptop.');
  };
  return {
    laptops: [{ id: 'demo-laptop', name: 'Demo laptop' }],
    async rename(laptopId, name) { requireLaptop(laptopId); this.laptops = [{ id: laptopId, name }]; },
    async connect(laptopId) {
      requireLaptop(laptopId);
      let active = true;
      const listeners = new Set<() => void>();
      const requireSession = (agentId?: string) => {
        if (!active) throw new Error('Demo pairing has been revoked or disconnected.');
        if (agentId && !messages.has(agentId)) throw new Error('Agent is outside this demo workspace.');
      };
      const session: CompanionSession = {
        async getWorkspace() {
          requireSession();
          return { teams: [{ id: 'demo-team', name: 'Companion demo', agentIds: agents.map((a) => a.id) }], agents };
        },
        async loadConversation(agentId) {
          requireSession(agentId);
          return {
            type: 'codex.conversationSnapshotChanged', seq: ++sequence,
            occurredAt: new Date().toISOString(), agentId, backend: 'codex', threadId: agentId,
            payload: { revision: sequence, snapshot: snapshot(agentId, [...messages.get(agentId)!]) },
          };
        },
        async sendPrompt({ agentId }, prompt) {
          requireSession(agentId);
          if (!prompt.trim()) throw new Error('Enter a prompt.');
          messages.get(agentId)!.push(
            textMessage(`prompt-${++sequence}`, 'user', prompt),
            textMessage(`reply-${++sequence}`, 'assistant', 'Demo prompt received. No laptop or coding agent was contacted.'),
          );
        },
        onDisconnect(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        close() {
          if (!active) return;
          active = false;
          sessions.delete(session);
          for (const listener of listeners) listener();
          listeners.clear();
        },
      };
      sessions.add(session);
      return session;
    },
    async revoke(laptopId) {
      requireLaptop(laptopId);
      for (const session of [...sessions]) session.close();
    },
  };
}

function textMessage(id: string, role: 'user' | 'assistant', text: string): SurfaceMessage {
  return { id, role, status: 'complete', createdAt: new Date().toISOString(), parts: [{ type: 'text', text }] };
}

function snapshot(agentId: string, messages: SurfaceMessage[]): CodexConversationSnapshot {
  return {
    status: 'ready', authentication: {
      status: 'loaded', account: null, requiresOpenaiAuth: false, error: null,
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [], activeConversationId: agentId, activeTurnId: null,
    turnIds: [], turns: [], messages, clientRequests: [], answeredClientRequestIds: [],
    approvals: [], models: [], modelCatalogStatus: 'loaded', skills: [], skillCatalogStatus: 'loaded',
    plugins: [], pluginCatalogStatus: 'loaded', permissionProfiles: [], approvalPresets: [],
    approvalPreset: null, selectedModelId: null, selectedReasoningEffort: null, selectedServiceTier: null,
    planMode: false, contextUsage: null, goal: null, turnGitDiff: null, threadStatus: null, rateLimits: null,
    queuedPrompts: [], busy: false, historyLoading: false, error: null,
  };
}
