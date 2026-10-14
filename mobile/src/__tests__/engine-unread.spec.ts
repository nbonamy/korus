import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';

describe('mobile shared unread activity', () => {
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
      await engine.dispatch({ type: 'read', agentId: 'demo-reviewer', revision: 2 });
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 3 });
      expect(markRead).not.toHaveBeenCalled();
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 2 });
      expect(markRead).toHaveBeenCalledExactlyOnceWith('demo-agent', 2);
      await engine.dispatch({ type: 'activity', active: false });
      await engine.dispatch({ type: 'read', agentId: 'demo-agent', revision: 2 });
      expect(markRead).toHaveBeenCalledTimes(1);
    } finally { engine.dispose(); }
  });
});
