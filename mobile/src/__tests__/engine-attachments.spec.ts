import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineEvent } from '../engine';
import { createDemoConnector } from '../demo-connector';

const photo = { type: 'image' as const, name: 'Photo.jpg', mimeType: 'image/jpeg', data: 'aW1hZ2U=' };
function fixture(remote = false) {
  const connector = createDemoConnector(); const connect = connector.connect;
  const sendPrompt = vi.fn(async () => {}); const commandStatus = vi.fn().mockResolvedValue('accepted'); const events: EngineEvent[] = [];
  connector.connect = async (id) => {
    const session = await connect(id);
    return { ...session, sendPrompt, commandStatus, getWorkspace: async () => {
      const workspace = await session.getWorkspace();
      return remote ? { ...workspace, teams: workspace.teams.map((team) => ({ ...team, remoteConnectionId: 'nested-host' })) } : workspace;
    } };
  };
  const engine = createEngine({ connector, post: (event) => events.push(event) });
  const open = async () => { await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); };
  return { engine, open, sendPrompt, commandStatus, events };
}

describe('native attachment submission', () => {
  it('delivers a late final receipt to the original native submission without replaying its attachment', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.open();
      f.sendPrompt.mockRejectedValueOnce(new Error('Timeout'));
      f.commandStatus.mockResolvedValueOnce('pending');
      await f.engine.dispatch({ type: 'send', requestId: 'slow', target: f.engine.snapshot().composerTarget!, text: '', uploads: [photo] });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.events.filter(event => event.type === 'sendResult')).toStrictEqual([
        { type: 'sendResult', requestId: 'slow', status: 'unknown' },
        { type: 'sendResult', requestId: 'slow', status: 'accepted' },
      ]);
      expect(f.sendPrompt).toHaveBeenCalledOnce();
    } finally { f.engine.dispose(); vi.useRealTimers(); }
  });
  it('accepts a native text-only send to a chat with no provider session', async () => {
    const f = fixture();
    try {
      await f.open();
      const target = f.engine.snapshot().composerTarget!;
      expect(target.sessionId).toBeNull();
      await f.engine.dispatch({ type: 'send', requestId: 'text', target, text: 'Hello', uploads: [] });
      expect(f.sendPrompt).toHaveBeenCalledExactlyOnceWith('demo-agent', 'Hello', expect.any(String), expect.anything());
      expect(f.events.at(-1)).toMatchObject({ type: 'sendResult', requestId: 'text', status: 'accepted' });
    } finally { f.engine.dispose(); }
  });

  it('keeps nested remote teams text-only until their host supports trusted file transfer', async () => {
    const f = fixture(true);
    try {
      await f.open();
      expect(f.engine.snapshot().capabilities.attachments).toBe(false);
      await f.engine.dispatch({ type: 'send', requestId: 'remote', target: f.engine.snapshot().composerTarget!, text: '', uploads: [photo] });
      expect(f.sendPrompt).not.toHaveBeenCalled();
      expect(f.events.at(-1)).toMatchObject({ type: 'sendResult', requestId: 'remote', status: 'rejected' });
    } finally { f.engine.dispose(); }
  });

  it('admits an attachment-only prompt and acknowledges it only after the laptop accepts it', async () => {
    const f = fixture();
    let accept!: () => void;
    f.sendPrompt.mockImplementationOnce(() => new Promise<void>((resolve) => { accept = resolve; }));
    try {
      await f.open();
      const sending = f.engine.dispatch({ type: 'send', requestId: 'send-1', target: f.engine.snapshot().composerTarget!, text: '', uploads: [photo] });
      await vi.waitFor(() => expect(f.sendPrompt).toHaveBeenCalledOnce());
      expect(f.events.filter((event) => event.type === 'sendResult')).toEqual([]);
      expect(f.sendPrompt).toHaveBeenCalledWith('demo-agent', '', expect.any(String), expect.anything(), [photo]);
      accept(); await sending;
      expect(f.events.at(-1)).toMatchObject({ type: 'sendResult', requestId: 'send-1', status: 'accepted' });
    } finally { f.engine.dispose(); }
  });

  it('rejects a stale destination and oversized upload before dispatch, and never replays uncertain sends', async () => {
    const f = fixture();
    try {
      await f.open();
      const target = f.engine.snapshot().composerTarget!;
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await f.engine.dispatch({ type: 'send', requestId: 'stale', target, text: 'Look', uploads: [photo] });
      expect(f.events.at(-1)).toMatchObject({ type: 'sendResult', requestId: 'stale', status: 'rejected' });
      await f.engine.dispatch({ type: 'send', requestId: 'large', target: f.engine.snapshot().composerTarget!, text: '', uploads: [{ ...photo, data: 'AAAA'.repeat(900_000) }] });
      expect(f.sendPrompt).not.toHaveBeenCalled();
      f.sendPrompt.mockRejectedValueOnce(new Error('Disconnected after dispatch'));
      await f.engine.dispatch({ type: 'send', requestId: 'unknown', target: f.engine.snapshot().composerTarget!, text: '', uploads: [photo] });
      expect(f.events.at(-1)).toMatchObject({ type: 'sendResult', requestId: 'unknown', status: 'unknown' });
      await f.engine.dispatch({ type: 'send', requestId: 'retry', target: f.engine.snapshot().composerTarget!, text: '', uploads: [photo] });
      expect(f.sendPrompt).toHaveBeenCalledTimes(1);
    } finally { f.engine.dispose(); }
  });
});
