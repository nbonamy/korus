import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { projectCompanionWorkspace } from '@workspace/core/companion-projection';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionSession } from '../companion-port';
import { createDemoConnector } from '../demo-connector';
import { createEngine } from '../engine';

describe('native activity drawer feed', () => {
  it('uses desktop section ordering and switches only Idle between recency and repository order', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async id => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      const base = workspace.agents[0]!;
      const rows = [
        ['demo-agent', 'idle', '11:00'], ['idle-new', 'idle', '11:30'],
        ['working-new', 'working', '11:59'], ['working-old', 'working', '11:58'],
        ['input-new', 'awaitingInput', '11:51'], ['input-old', 'awaitingInput', '11:50'],
        ['done-new', 'idle', '11:59'], ['done-old', 'idle', '11:58'],
      ] as const;
      workspace.agents = rows.map(([id, type, time]) => ({ ...base, id, name: id, hasSubmittedPrompt: true,
        status: { type }, lastActivityAt: `2026-10-16T${time}:00Z` }));
      workspace.teams[0]!.agentIds = workspace.agents.map(a => a.id);
      return { ...session, getWorkspace: async () => projectCompanionWorkspace(workspace) };
    };
    const engine = createEngine({ connector, post() {} });
    const order = () => engine.snapshot().activityGroups.map(g => [g.activity, g.sessions.map(s => s.agentId)]);
    try {
      await engine.start();
      const recent = order();
      expect(recent).toStrictEqual([
        ['attention', ['input-old', 'input-new']], ['recent', ['done-old', 'done-new']],
        ['working', ['working-old', 'working-new']], ['idle', ['idle-new', 'demo-agent']],
      ]);
      const selected = engine.snapshot().agentId;
      await engine.dispatch({ type: 'idleSort', order: 'repository' });
      expect(order()).toStrictEqual([...recent.slice(0, 3), ['idle', ['demo-agent', 'idle-new']]]);
      expect(engine.snapshot().agentId).toBe(selected);
      await engine.dispatch({ type: 'idleSort', order: 'activity' });
      expect(order()).toStrictEqual(recent);
    } finally { engine.dispose(); vi.useRealTimers(); }
  });

  it('moves live work through attention, working, recent and idle without changing the open conversation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    const connector = createDemoConnector(); const connect = connector.connect;
    let workspace!: CompanionWorkspace;
    let update!: Parameters<NonNullable<CompanionSession['onUpdate']>>[0];
    connector.connect = async id => {
      const session = await connect(id); workspace = await session.getWorkspace();
      workspace.agents = workspace.agents.map(a => ({ ...a, hasSubmittedPrompt: true, lastActivityAt: '2026-10-15T11:00:00Z' }));
      return { ...session, getWorkspace: async () => projectCompanionWorkspace(workspace), onUpdate(listener) { update = listener; return () => {}; } };
    };
    const engine = createEngine({ connector, post() {} });
    const locations = () => engine.snapshot().activityGroups.map(g => [g.activity, g.sessions.map(s => s.agentId)]);
    const publish = async (status: 'awaitingInput' | 'working' | 'idle') => {
      workspace = { ...workspace, agents: workspace.agents.map(a => a.id === 'demo-agent' ? { ...a, status: { type: status },
        lastActivityAt: new Date().toISOString(), readState: { revision: 2, readRevision: 1 } } : a) };
      update(projectCompanionWorkspace(workspace), null); await nextTick();
    };
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const before = engine.snapshot();
      expect(locations()).toStrictEqual([['idle', ['demo-agent', 'demo-reviewer']]]);
      await publish('awaitingInput'); expect(locations()[0]).toStrictEqual(['attention', ['demo-agent']]);
      await publish('working'); expect(locations()[0]).toStrictEqual(['working', ['demo-agent']]);
      await publish('idle'); expect(locations()[0]).toStrictEqual(['recent', ['demo-agent']]);
      const recent = engine.snapshot().activityGroups[0]!.sessions[0]!;
      expect(recent.isUnread).toBe(true);
      expect(engine.snapshot().activityGroups[0]!.label).toBe('Done');
      expect(recent.displayTitle).toBe('Builder');
      await vi.advanceTimersByTimeAsync(301_000);
      expect(locations()).toStrictEqual([['recent', ['demo-agent']], ['idle', ['demo-reviewer']]]);
      expect(engine.snapshot().activityGroups[0]!.sessions[0]!.isUnread).toBe(true);
      // A read receipt removes the unread hold without manufacturing new activity.
      workspace = { ...workspace, agents: workspace.agents.map(a => a.id === 'demo-agent'
        ? { ...a, readState: { revision: 2, readRevision: 2 } } : a) };
      update(projectCompanionWorkspace(workspace), null); await nextTick();
      expect(locations()).toStrictEqual([['idle', ['demo-agent', 'demo-reviewer']]]);
      expect(engine.snapshot().composerTarget).toStrictEqual(before.composerTarget);
      expect(engine.snapshot().agentId).toBe('demo-agent');
    } finally { engine.dispose(); vi.useRealTimers(); }
  });

  it('offers Claude Fast mode from the laptop catalog and preserves it through reload, send and Standard', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const selectModel = vi.fn(async () => {}); const sendPrompt = vi.fn(async () => {});
    connector.connect = async id => {
      const session = await connect(id); const workspace = await session.getWorkspace();
      workspace.agents = workspace.agents.map(a => ({ ...a, backend: 'claude', backendDefaults: { kind: 'claude', model: 'opus', serviceTier: 'fast' } }));
      return { ...session, getWorkspace: async () => projectCompanionWorkspace(workspace), selectModel, sendPrompt,
        loadConversation: async agentId => ({ type: 'claude.conversationSnapshotChanged', agentId, backend: 'claude', seq: 1, occurredAt: '2026-10-15T12:00:00Z',
          payload: { revision: 1, snapshot: { agentId, sessionId: 'session', activeTurnId: null, turnIds: [], turns: [], messages: [],
            answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } }),
        listModels: async () => [{ id: 'opus', model: 'opus', displayName: 'Opus', isDefault: true, supportedReasoningEfforts: [],
          serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }] }],
      };
    };
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await vi.waitFor(() => expect(engine.snapshot().models).toHaveLength(1));
      expect(engine.snapshot().capabilities.serviceTier).toBe(true);
      expect(engine.snapshot().composer.serviceTier).toBe('fast');
      await engine.dispatch({ type: 'send', text: 'Continue' });
      expect(sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Continue', expect.any(String), expect.objectContaining({ serviceTier: 'fast' }));
      await engine.dispatch({ type: 'composer', change: { serviceTier: null } });
      expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'opus', reasoningEffort: null, serviceTier: null });
      await engine.dispatch({ type: 'send', text: 'Continue normally' });
      expect(sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Continue normally', expect.any(String), expect.objectContaining({ serviceTier: null }));
    } finally { engine.dispose(); }
  });
});
