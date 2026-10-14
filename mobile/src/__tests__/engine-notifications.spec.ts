import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineEvent } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionNotification } from '@workspace/core/companion-notification';

async function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const registerPush = vi.fn(async () => {});
  let notify: (notification: CompanionNotification) => void = () => {};
  connector.connect = async id => ({ ...await connect(id), registerPush,
    onNotification(listener) { notify = listener; return () => { notify = () => {}; }; } });
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: event => events.push(event) });
  await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
  return { engine, events, registerPush, notify: (notification: CompanionNotification) => notify(notification) };
}
describe('native notification bridge', () => {
  it('forwards live attention once per event and restores token registration on reconnect', async () => {
    const f = await fixture();
    try {
      const notification: CompanionNotification = { id: 'event', target: f.engine.snapshot().composerTarget!, kind: 'completed', name: 'Builder', createdAt: Date.now() };
      f.notify(notification);
      expect(f.events.filter(event => event.type === 'notification')).toStrictEqual([{ type: 'notification', notification }]);
      const registration = { token: 'ab'.repeat(32), environment: 'development' as const };
      await f.engine.dispatch({ type: 'pushRegistration', registration });
      await f.engine.dispatch({ type: 'activity', active: false });
      f.notify(notification);
      await f.engine.dispatch({ type: 'activity', active: true });
      expect(f.events.filter(event => event.type === 'notification')).toHaveLength(1);
      expect(f.registerPush).toHaveBeenCalledTimes(2);
      expect(f.registerPush).toHaveBeenLastCalledWith(registration);
      await f.engine.dispatch({ type: 'pushRegistration', registration: null });
      expect(f.registerPush).toHaveBeenLastCalledWith(null);
    } finally { f.engine.dispose(); }
  });
  it('opens the notification target across navigation, rejecting stale sessions and unpaired hosts', async () => {
    const f = await fixture();
    try {
      const original = f.engine.snapshot().composerTarget!;
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      // Swift dictionary serialization does not promise key order.
      const target = { sessionId: original.sessionId, agentId: original.agentId, teamId: original.teamId, locationId: original.locationId, hostId: original.hostId };
      await f.engine.dispatch({ type: 'openNotification', target });
      expect(f.engine.snapshot().agentId).toBe('demo-agent');
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await f.engine.dispatch({ type: 'openNotification', target: { ...target, sessionId: 'old' } });
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
      expect(f.events.at(-1)).toStrictEqual({ type: 'notificationOpenFailed' });
      await f.engine.dispatch({ type: 'openNotification', target: { ...target, hostId: 'unpaired' } });
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
    } finally { f.engine.dispose(); }
  });
});
