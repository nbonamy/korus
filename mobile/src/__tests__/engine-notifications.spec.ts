import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineEvent } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionNotification } from '@workspace/core/companion-notification';

async function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const registerPush = vi.fn(async () => {});
  let notify: (notification: CompanionNotification) => void = () => {};
  const loadedAgents: string[] = [];
  connector.connect = async id => {
    const session = await connect(id);
    return { ...session, registerPush,
      async loadConversation(agentId) { loadedAgents.push(agentId); return session.loadConversation(agentId); },
      onNotification(listener) { notify = listener; return () => { notify = () => {}; }; } };
  };
  const events: EngineEvent[] = [];
  const engine = createEngine({ connector, post: event => events.push(event) });
  await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
  return { engine, events, registerPush, loadedAgents, notify: (notification: CompanionNotification) => notify(notification) };
}
describe('native notification bridge', () => {
  it.each(['reconnect', 'workspace update'])('reconciles desktop reads from persisted state on %s', async mode => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let read = false;
    let notifyWorkspace = async () => {};
    connector.connect = async id => {
      const session = await connect(id);
      const getWorkspace = async () => {
        const workspace = await session.getWorkspace();
        return { ...workspace, agents: workspace.agents.map(agent => ({ ...agent, ...(read ? { readState: { revision: 3, readRevision: 2 } } : {}) })) };
      };
      return { ...session, getWorkspace, onUpdate(listener) {
        notifyWorkspace = async () => { listener(await getWorkspace(), null); };
        return session.onUpdate?.(listener) ?? (() => {});
      } };
    };
    const events: EngineEvent[] = []; const engine = createEngine({ connector, post: e => events.push(e) });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const target = engine.snapshot().composerTarget!;
      if (mode === 'reconnect') await engine.dispatch({ type: 'disconnect' });
      read = true; events.length = 0;
      if (mode === 'reconnect') await engine.dispatch({ type: 'reconnect' });
      else await notifyWorkspace();
      expect(events).toContainEqual({ type: 'notification', notification: { id: 'read', kind: 'read', name: '', revision: 2, createdAt: expect.any(Number), target } });
    } finally { engine.dispose(); }
  });
  it('forwards read clearing while backgrounded instead of treating it as a visible alert', async () => {
    const f = await fixture();
    try {
      const target = f.engine.snapshot().composerTarget!;
      await f.engine.dispatch({ type: 'activity', active: false });
      f.events.length = 0;
      const read = { id: 'read', kind: 'read' as const, revision: 3, target, name: '', createdAt: Date.now() };
      f.notify(read);
      expect(f.events).toContainEqual({ type: 'notification', notification: read });
    } finally { f.engine.dispose(); }
  });

  it('keeps a cold-launch tap through pairing initialization and saved conversation restoration', async () => {
    const connector = createDemoConnector();
    const paired = connector.laptops;
    connector.laptops = [];
    let initialize!: () => void;
    connector.initialize = async () => {
      await new Promise<void>(resolve => { initialize = resolve; });
      connector.laptops = paired;
    };
    const events: EngineEvent[] = [];
    const write = vi.fn(async () => {});
    const engine = createEngine({ connector, initialActive: false, post: event => events.push(event), selectionStore: {
      readLastLaptop: async () => null, writeLastLaptop: async () => {},
      read: async () => ({ teamId: 'demo-team', agentId: 'demo-reviewer' }), write, remove: async () => {},
    } });
    const target = { hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null };
    try {
      const starting = engine.start();
      await engine.dispatch({ type: 'openNotification', target });
      await engine.dispatch({ type: 'activity', active: true });
      initialize(); await starting;
      expect(events.filter(event => event.type === 'notificationOpenFailed')).toStrictEqual([]);
      expect(engine.snapshot().agentId).toBe(target.agentId);
      expect(engine.snapshot().conversationReady).toBe(true);
      expect(write).toHaveBeenLastCalledWith(target.hostId, { teamId: target.teamId, agentId: target.agentId });
    } finally { initialize?.(); engine.dispose(); }
  });

  it.each(['background', 'reconnecting'] as const)('retains a tapped push across %s and foreground restoration', async phase => {
    const connector = createDemoConnector();
    const connect = connector.connect;
    let release!: () => void;
    let block = false;
    connector.connect = async id => {
      if (block) await new Promise<void>(resolve => { release = resolve; });
      return connect(id);
    };
    const events: EngineEvent[] = [];
    const engine = createEngine({ connector, post: event => events.push(event) });
    try {
      await engine.start();
      await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const target = engine.snapshot().composerTarget!;
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      if (phase === 'background') await engine.dispatch({ type: 'activity', active: false });
      else await engine.dispatch({ type: 'disconnect' });
      block = true;
      let settled = false;
      const tapped = engine.dispatch({ type: 'openNotification', target }).finally(() => { settled = true; });
      await vi.waitFor(() => expect(settled || typeof release === 'function').toBe(true));
      // iOS can deliver its notification response before the active/unlocked scene callbacks.
      await engine.dispatch({ type: 'activity', active: false });
      block = false;
      release?.(); await tapped;
      await engine.dispatch({ type: 'activity', active: true });
      expect(events.filter(event => event.type === 'notificationOpenFailed')).toStrictEqual([]);
      expect(engine.snapshot().agentId).toBe(target.agentId);
      expect(engine.snapshot().conversationReady).toBe(true);
    } finally { release?.(); engine.dispose(); }
  });

  it('opens only the latest deferred notification and lets explicit navigation cancel it', async () => {
    const f = await fixture();
    try {
      const target = f.engine.snapshot().composerTarget!;
      const reviewer = { ...target, agentId: 'demo-reviewer' };
      await f.engine.dispatch({ type: 'activity', active: false });
      await f.engine.dispatch({ type: 'openNotification', target });
      await f.engine.dispatch({ type: 'openNotification', target: reviewer });
      f.loadedAgents.length = 0;
      await f.engine.dispatch({ type: 'activity', active: true });
      expect(f.loadedAgents).toStrictEqual([reviewer.agentId]);
      expect(f.engine.snapshot().agentId).toBe(reviewer.agentId);
      await f.engine.dispatch({ type: 'activity', active: false });
      await f.engine.dispatch({ type: 'openNotification', target });
      await f.engine.dispatch({ type: 'selectAgent', id: reviewer.agentId });
      await f.engine.dispatch({ type: 'activity', active: true });
      expect(f.engine.snapshot().agentId).toBe(reviewer.agentId);
      expect(f.events.filter(event => event.type === 'notificationOpenFailed')).toStrictEqual([]);
    } finally { f.engine.dispose(); }
  });

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
      expect(f.registerPush).toHaveBeenCalledTimes(1); // Quick switches retain the existing session and registration.
      await f.engine.dispatch({ type: 'disconnect' });
      await f.engine.dispatch({ type: 'reconnect' });
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
