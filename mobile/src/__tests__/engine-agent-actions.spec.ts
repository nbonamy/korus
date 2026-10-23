import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionTarget } from '@workspace/core/companion-protocol';

// Native name prompts can outlive selection or disconnect; renaming must preserve
// the transcript and never silently target a different conversation.
describe('mobile agent rename', () => {
  it('updates labels without reloading the transcript, rejects stale targets, and reports a failed save for retry', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let renamed: string | undefined;
    const renameAgent = vi.fn(async (_target: CompanionTarget, name: string) => { renamed = name; });
    const reads = vi.fn();
    connector.connect = async id => {
      const session = await connect(id);
      return { ...session, renameAgent,
        loadConversation: async id => { reads(id); return session.loadConversation(id); },
        getWorkspace: async () => {
          const workspace = await session.getWorkspace();
          return { ...workspace, agents: workspace.agents.map(agent => agent.id === 'demo-agent' && renamed ? { ...agent, name: renamed } : agent) };
        } };
    };
    const engine = createEngine({ connector, post() {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const target = engine.snapshot().composerTarget!;
      const initialReads = reads.mock.calls.length;
      await engine.dispatch({ type: 'renameAgent', target: { ...target, sessionId: 'replaced' }, name: 'Wrong' });
      await engine.dispatch({ type: 'renameAgent', target, name: '   ' });
      expect(renameAgent).not.toHaveBeenCalled();
      renameAgent.mockRejectedValueOnce(new Error('offline'));
      await engine.dispatch({ type: 'renameAgent', target, name: 'Mobile work' });
      expect(engine.snapshot().sessionActionFailed).toBe(true);
      await engine.dispatch({ type: 'renameAgent', target, name: '  Mobile work  ' });
      expect(renameAgent).toHaveBeenLastCalledWith(target, 'Mobile work');
      expect(engine.snapshot()).toMatchObject({ agentId: target.agentId, header: { title: 'Mobile work' }, conversationReady: true, sessionAction: null, sessionActionFailed: false });
      expect(reads).toHaveBeenCalledTimes(initialReads);
      let release!: () => void;
      renameAgent.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
      const pending = engine.dispatch({ type: 'renameAgent', target, name: 'Pending rename' });
      expect(engine.snapshot().sessionAction).toBe('rename');
      const attempts = renameAgent.mock.calls.length;
      await engine.dispatch({ type: 'renameAgent', target, name: 'Repeated tap' });
      expect(renameAgent).toHaveBeenCalledTimes(attempts);
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      release(); await pending;
      expect(engine.snapshot().agentId).toBe('demo-reviewer');
    } finally { engine.dispose(); }
  });
});
