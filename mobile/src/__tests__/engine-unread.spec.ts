import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';

describe('mobile shared unread activity', () => {
  it('rejects pre-disconnect render receipts after reconnect even when the numeric revision is unchanged', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const markRead = vi.fn(async () => {}); const interrupt = vi.fn(async () => {});
    let resolveHistory!: () => void; let waitForHistory = false;
    connector.connect = async id => {
      const session = await connect(id);
      return { ...session, markRead, interrupt, getWorkspace: async () => {
        const workspace = await session.getWorkspace();
        return { ...workspace, agents: workspace.agents.map(agent => ({ ...agent, readState: { revision: 2, readRevision: 1 } })) };
      }, loadConversation: async agentId => {
        if (waitForHistory) await new Promise<void>(resolve => { resolveHistory = resolve; });
        return session.loadConversation(agentId);
      } };
    };
    const engine = createEngine({ connector, post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const old = { type: 'read' as const, agentId: 'demo-agent', revision: 2, generation: engine.snapshot().conversationGeneration };
      await engine.dispatch({ type: 'disconnect' });
      waitForHistory = true;
      const reconnect = engine.dispatch({ type: 'reconnect' });
      await vi.waitFor(() => expect(resolveHistory).toBeTypeOf('function'));
      expect(engine.snapshot().capabilities.interrupt).toBe(false);
      await engine.dispatch({ type: 'interrupt' });
      expect(interrupt).not.toHaveBeenCalled();
      resolveHistory(); await reconnect;
      await engine.dispatch(old);
      expect(markRead).not.toHaveBeenCalled();
      await engine.dispatch({ ...old, generation: engine.snapshot().conversationGeneration });
      expect(markRead).toHaveBeenCalledExactlyOnceWith('demo-agent', 2);
    } finally { engine.dispose(); }
  });
  it('shows chat and team unread state, and acknowledges only a foreground rendered selection', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const markRead = vi.fn(async () => {});
    connector.connect = async id => {
      const session = await connect(id);
      return { ...session, markRead, getWorkspace: async () => {
        const workspace = await session.getWorkspace();
        return { ...workspace, agents: workspace.agents.map(agent => ({ ...agent, readState: { revision: 2, readRevision: 1 } })) };
      } };
    };
    const engine = createEngine({ connector, post: () => {} });
    try {
      await engine.start();
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(engine.snapshot().teams.find(team => team.id === 'demo-team')?.isUnread).toBe(true);
      expect(engine.snapshot().groups.flatMap(group => group.sessions).find(chat => chat.agentId === 'demo-agent')?.isUnread).toBe(true);
      expect(markRead).not.toHaveBeenCalled();
      const generation = engine.snapshot().conversationGeneration;
      await engine.dispatch({ type: 'read', agentId: 'demo-reviewer', revision: 2, generation });
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 3, generation });
      expect(markRead).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 2, generation });
      expect(markRead).toHaveBeenCalledExactlyOnceWith('demo-agent', 2);
      await engine.dispatch({ type: 'activity', active: false });
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 2, generation });
      expect(markRead).toHaveBeenCalledTimes(1);
    } finally { engine.dispose(); }
  });
});
