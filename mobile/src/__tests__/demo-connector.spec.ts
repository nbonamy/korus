import { describe, expect, it } from 'vitest';
import { createDemoConnector } from '../demo-connector';

describe('local demo pairing boundary', () => {
  it('rejects unknown laptops and agents and revokes all existing sessions', async () => {
    const connector = createDemoConnector();
    await expect(connector.connect('unpaired-peer')).rejects.toThrow();
    const first = await connector.connect('demo-laptop');
    const second = await connector.connect('demo-laptop');
    await expect(first.loadConversation('foreign-agent')).rejects.toThrow();
    await expect(first.sendPrompt({ hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'foreign-agent', sessionId: null }, 'hello')).rejects.toThrow();
    await expect(first.sendPrompt({ hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, ' ')).rejects.toThrow();
    let closed = 0;
    first.onDisconnect(() => closed++);
    const unsubscribe = second.onDisconnect(() => closed++);
    unsubscribe();
    await expect(connector.revoke('unknown')).rejects.toThrow();
    await connector.revoke('demo-laptop');
    expect(closed).toBe(1);
    await expect(first.getWorkspace()).rejects.toThrow();
    await expect(second.sendPrompt({ hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, 'hello')).rejects.toThrow();
    first.close();
    expect(closed).toBe(1);
  });

  it('keeps accepted prompts isolated between agents across reconnect', async () => {
    const connector = createDemoConnector();
    const session = await connector.connect('demo-laptop');
    await session.sendPrompt({ hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, 'Review this change');
    session.close();
    const next = await connector.connect('demo-laptop');
    const builder = await next.loadConversation('demo-agent');
    const reviewer = await next.loadConversation('demo-reviewer');
    expect(builder!.payload.snapshot.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(reviewer!.payload.snapshot.messages.filter((m) => m.role === 'user')).toHaveLength(0);
    next.close();
  });
});
