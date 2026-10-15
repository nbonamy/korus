import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineEvent } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionWorkspace, CompanionSession } from '../companion-port';

function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const sendPrompt = vi.fn(async () => {}); const events: EngineEvent[] = [];
  const updateQueuedPrompt = vi.fn(async () => {});
  let workspace!: CompanionWorkspace;
  let update: Parameters<NonNullable<CompanionSession['onUpdate']>>[0] | undefined;
  connector.connect = async id => {
    const session = await connect(id);
    workspace = await session.getWorkspace();
    return { ...session, sendPrompt, updateQueuedPrompt, getWorkspace: async () => workspace, onUpdate(listener) { update = listener; return () => { update = undefined; }; } };
  };
  const engine = createEngine({ connector, post: event => events.push(event) });
  return { engine, sendPrompt, updateQueuedPrompt, events,
    async open() { await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); },
    queue(queuedPrompts: NonNullable<CompanionWorkspace['queuedPrompts']>) { workspace = { ...workspace, queuedPrompts }; update?.(workspace, null); },
  };
}

describe('mobile queued messages', () => {
  it.each(['steer', 'delete'] as const)('captures the queue target and blocks duplicate %s taps until the host resolves', async action => {
    const f = fixture();
    try {
      await f.open();
      f.queue([{ id: 'one', agentId: 'demo-agent', text: 'Next task' }]);
      let finish!: () => void;
      f.updateQueuedPrompt.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
      const target = f.engine.snapshot().composerTarget!;
      const command = { type: 'queuedPrompt' as const, target: Object.fromEntries(Object.entries(target).reverse()) as typeof target, promptId: 'one', action };
      const sending = f.engine.dispatch(command);
      expect(f.engine.snapshot().queuedPromptPending).toBe('one');
      await f.engine.dispatch(command);
      expect(f.updateQueuedPrompt).toHaveBeenCalledExactlyOnceWith(target, 'one', action);
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([{ id: 'one', text: 'Next task' }]);
      f.queue([]); finish(); await sending;
      expect(f.engine.snapshot().queuedPromptPending).toBeNull();
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([]);
    } finally { f.engine.dispose(); }
  });

  it('retains a failed action for inspection without replay and refuses a stale native target', async () => {
    const f = fixture();
    try {
      await f.open();
      f.queue([{ id: 'one', agentId: 'demo-agent', text: 'Next task' }]);
      const target = f.engine.snapshot().composerTarget!;
      await f.engine.dispatch({ type: 'queuedPrompt', target: { ...target, sessionId: 'replaced' }, promptId: 'one', action: 'steer' });
      expect(f.updateQueuedPrompt).not.toHaveBeenCalled();
      f.updateQueuedPrompt.mockRejectedValueOnce(new Error('Delivery unknown'));
      await f.engine.dispatch({ type: 'queuedPrompt', target, promptId: 'one', action: 'steer' });
      expect(f.engine.snapshot().queuedPromptFailed).toBe(true);
      expect(f.engine.snapshot().queuedPromptPending).toBeNull();
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([{ id: 'one', text: 'Next task' }]);
      expect(f.updateQueuedPrompt).toHaveBeenCalledOnce();
    } finally { f.engine.dispose(); }
  });

  it.each(['queue', 'steer'] as const)('captures the per-message choice through native admission (%s)', async followUpBehavior => {
    const f = fixture();
    try {
      await f.open();
      await f.engine.dispatch({ type: 'send', requestId: 'native-send', target: f.engine.snapshot().composerTarget!, text: 'Follow up', followUpBehavior });
      expect(f.sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Follow up', expect.any(String), expect.objectContaining({ followUpBehavior }));
      expect(f.events.filter(event => event.type === 'sendResult')).toStrictEqual([{ type: 'sendResult', requestId: 'native-send', status: 'accepted' }]);
    } finally { f.engine.dispose(); }
  });

  it('previews only the selected agent queue and follows host removals and conversation changes', async () => {
    const f = fixture();
    try {
      await f.open();
      f.queue([{ id: 'one', agentId: 'demo-agent', text: 'Next task' }, { id: 'other', agentId: 'demo-reviewer', text: 'Other conversation' }]);
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([{ id: 'one', text: 'Next task' }]);
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([{ id: 'other', text: 'Other conversation' }]);
      f.queue([]);
      expect(f.engine.snapshot().queuedPrompts).toStrictEqual([]);
    } finally { f.engine.dispose(); }
  });
});
