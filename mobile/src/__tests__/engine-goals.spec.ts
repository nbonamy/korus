import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineEvent } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionTarget, CompanionWorkspace } from '@workspace/core/companion-protocol';

async function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const changeGoal = vi.fn< (target: CompanionTarget, objective: string | null) => Promise<void> >(async () => {});
  const sendPrompt = vi.fn(async () => {}); const events: EngineEvent[] = [];
  let workspace!: CompanionWorkspace;
  let publish!: (workspace: CompanionWorkspace) => void;
  connector.connect = async id => {
    const session = await connect(id); workspace = await session.getWorkspace();
    return { ...session, changeGoal, sendPrompt, getWorkspace: async () => structuredClone(workspace),
      onUpdate(listener) { publish = next => { workspace = next; listener(structuredClone(next), null); }; return () => {}; } };
  };
  const engine = createEngine({ connector, post: event => events.push(event) });
  await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
  return { engine, changeGoal, sendPrompt, events, publish: () => publish(workspace), workspace };
}
const goal = { threadId: 'demo-thread', objective: 'Finish the feature', status: 'active' as const, tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 };

describe('native goals', () => {
  it('sets and clears a goal through the desktop command boundary and projects host updates', async () => {
    const f = await fixture();
    try {
      const target = f.engine.snapshot().composerTarget!;
      f.changeGoal.mockImplementation(async (_target, objective) => { f.workspace.agents[0]!.goal = objective ? { ...goal, objective } : undefined; });
      await f.engine.dispatch({ type: 'send', requestId: 'goal', target, text: ' Finish the feature ', goalMode: true });
      expect(f.changeGoal).toHaveBeenCalledExactlyOnceWith(target, 'Finish the feature');
      expect(f.sendPrompt).not.toHaveBeenCalled();
      expect(f.events).toContainEqual({ type: 'sendResult', requestId: 'goal', status: 'accepted' });
      expect(f.engine.snapshot().goal).toStrictEqual({ objective: goal.objective, status: 'active' });
      await f.engine.dispatch({ type: 'clearGoal', target });
      expect(f.changeGoal).toHaveBeenLastCalledWith(target, null);
      expect(f.engine.snapshot().goal).toBeNull();
      f.workspace.agents[0]!.goal = { ...goal, status: 'complete' }; f.publish();
      expect(f.engine.snapshot().goal).toStrictEqual({ objective: goal.objective, status: 'complete' });
    } finally { f.engine.dispose(); }
  });
  it('rejects stale, unsupported, offline, empty and attachment-bearing goal requests', async () => {
    const f = await fixture();
    try {
      const target = f.engine.snapshot().composerTarget!;
      for (const extra of [{ target: { ...target, sessionId: 'old' } }, { text: '  ' }, { uploads: [{ type: 'file' as const, name: 'x.txt', mimeType: 'text/plain', data: 'eA==' }] }]) {
        await f.engine.dispatch({ type: 'send', goalMode: true, requestId: 'invalid', target, text: 'Goal', ...extra });
        expect(f.events.at(-1)).toStrictEqual({ type: 'sendResult', requestId: 'invalid', status: 'rejected' });
      }
      f.workspace.agents[0]!.backend = 'antigravity'; f.publish();
      await f.engine.dispatch({ type: 'clearGoal', target });
      await f.engine.dispatch({ type: 'disconnect' });
      await f.engine.dispatch({ type: 'clearGoal', target });
      expect(f.changeGoal).not.toHaveBeenCalled();
    } finally { f.engine.dispose(); }
  });
  it('keeps a new goal pending when the host assigns its first session, then reports uncertainty without replaying', async () => {
    const f = await fixture(); let reject!: (error: Error) => void;
    try {
      const target = f.engine.snapshot().composerTarget!;
      f.changeGoal.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
      const pending = f.engine.dispatch({ type: 'send', goalMode: true, requestId: 'goal', target, text: 'Finish' });
      f.workspace.agents[0]!.backendSession = { kind: 'codex', threadId: 'new-session' }; f.publish();
      expect(f.engine.snapshot().goalBusy).toBe(true);
      await f.engine.dispatch({ type: 'clearGoal', target: f.engine.snapshot().composerTarget! });
      expect(f.changeGoal).toHaveBeenCalledTimes(1);
      reject(new Error('Connection lost')); await pending;
      expect(f.engine.snapshot().goalError).toBe(true);
      expect(f.events).toContainEqual({ type: 'sendResult', requestId: 'goal', status: 'unknown' });
      expect(f.changeGoal).toHaveBeenCalledTimes(1);
    } finally { f.engine.dispose(); }
  });
  it('prevents duplicate starts and keeps late failures with their original conversation', async () => {
    const f = await fixture(); let reject!: (error: Error) => void;
    try {
      const target = f.engine.snapshot().composerTarget!;
      f.changeGoal.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
      const command = { type: 'send' as const, goalMode: true, requestId: 'pending', target, text: 'Finish' };
      const pending = f.engine.dispatch(command);
      expect(f.engine.snapshot().goalBusy).toBe(true);
      await f.engine.dispatch({ ...command, requestId: 'duplicate' });
      expect(f.changeGoal).toHaveBeenCalledTimes(1);
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      reject(new Error('Connection lost')); await pending;
      expect(f.engine.snapshot().goalBusy).toBe(false);
      expect(f.engine.snapshot().goalError).toBe(false);
      expect(f.events).toContainEqual({ type: 'sendResult', requestId: 'pending', status: 'unknown' });
    } finally { f.engine.dispose(); }
  });
});
