import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CompanionGateway, type GatewayState } from '../gateway';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
const workspace: CompanionWorkspace = {
  teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }, { id: 'remote-team', name: 'Remote', agentIds: ['remote-agent'], remoteConnectionId: 'ssh-host' }],
  agents: [{ id: 'agent', name: 'Agent', teamId: 'team', folder: '/private', backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '', mcpSessionId: 'private-session' },
    { id: 'remote-agent', name: 'Remote', teamId: 'remote-team', folder: '/private', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' }],
};
const target = { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null };
function fixture() {
  let now = 1;
  let saved: GatewayState = { grants: [], commands: {} };
  const port = { workspace: vi.fn(async () => workspace), conversation: vi.fn(), submit: vi.fn(async () => {}),
    save: vi.fn(async (state: GatewayState) => { saved = structuredClone(state); }), revoked: vi.fn() };
  const gateway = new CompanionGateway('host', saved, port, () => now);
  return { gateway, port, advance: () => { now += 300_001; }, saved: () => saved,
    async pair(canSend = true, teamIds = ['team']) {
      const invite = gateway.invite();
      const result = await gateway.request('phone', 'pair.request', { ...pickInvite(invite), name: 'Phone' }) as { pendingId: string };
      await gateway.decide(result.pendingId, true, teamIds, canSend);
      return invite;
    } };
}
function pickInvite(invite: { inviteId: string; inviteSecret: string }) { return { inviteId: invite.inviteId, inviteSecret: invite.inviteSecret }; }
describe('companion authorization gateway', () => {
  it('permits only pairing before explicit approval; rejects expiry, replay and a competing peer', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    const args = { ...pickInvite(invite), name: 'Phone' };
    const pending = await f.gateway.request('phone', 'pair.request', args) as { pendingId: string };
    expect(await f.gateway.request('phone', 'pair.request', args)).toStrictEqual(pending);
    await expect(f.gateway.request('other-phone', 'pair.request', args)).rejects.toThrow('claimed');
    await expect(f.gateway.request('other-phone', 'pair.status', { pendingId: pending.pendingId })).rejects.toThrow();
    await f.gateway.decide(pending.pendingId, true, ['team'], true);
    await expect(f.gateway.request('other-phone', 'pair.request', args)).rejects.toThrow('expired');
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: pending.pendingId })).toMatchObject({ state: 'approved' });
    const expired = f.gateway.invite(); f.advance();
    await expect(f.gateway.request('phone', 'pair.request', { ...pickInvite(expired), name: 'Phone' })).rejects.toThrow('expired');
  });
  it('recovers an approved device pairing record without leaving a pending approval or extending its scope', async () => {
    const f = fixture(); await f.pair(false);
    const invite = f.gateway.invite();
    const result = await f.gateway.request('phone', 'pair.request', { ...pickInvite(invite), name: 'Recovered phone' }) as { pendingId: string };
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: result.pendingId })).toMatchObject({ state: 'approved', grant: { canSend: false } });
    expect(f.gateway.pendingRequests).toEqual([]);
    await expect(f.gateway.request('other-phone', 'pair.request', { ...pickInvite(invite), name: 'Other' })).rejects.toThrow('expired');
  });
  it('expires an invitation while desktop approval is waiting on the owning workspace', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const { pendingId } = await f.gateway.request('phone', 'pair.request', { ...pickInvite(invite), name: 'Phone' }) as { pendingId: string };
    f.port.workspace.mockImplementationOnce(async () => { f.advance(); return workspace; });
    await expect(f.gateway.decide(pendingId, true, ['team'], true)).rejects.toThrow('expired');
    expect(f.port.save).not.toHaveBeenCalled();
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
  });
  it('does not deliver a read that completes after local revocation', async () => {
    const f = fixture(); await f.pair();
    let complete!: (value: CompanionWorkspace) => void;
    f.port.workspace.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const read = f.gateway.request('phone', 'snapshot.get', {});
    await f.gateway.revoke('phone'); complete(workspace);
    await expect(read).rejects.toThrow('authorized');
  });
  it('projects only granted teams and rejects forged location, team, session and raw RPC', async () => {
    const f = fixture(); await f.pair();
    expect(await f.gateway.request('phone', 'snapshot.get', {})).toMatchObject({ teams: [{ id: 'team' }], agents: [{ id: 'agent', folder: null }] });
    const projected = await f.gateway.request('phone', 'snapshot.get', {}) as CompanionWorkspace;
    expect(projected.agents[0]).not.toHaveProperty('mcpSessionId');
    expect(projected.agents).toHaveLength(1);
    for (const forged of [{ ...target, hostId: 'other' }, { ...target, locationId: 'ssh-host' }, { ...target, teamId: 'remote-team' }, { ...target, sessionId: 'other' }]) {
      await expect(f.gateway.request('phone', 'conversation.subscribe', forged)).rejects.toThrow('scope');
    }
    await expect(f.gateway.request('phone', 'agent/git/push', {})).rejects.toThrow('supported');
    await expect(f.gateway.request('phone', 'snapshot.get', { _clientId: 'desktop' })).rejects.toThrow();
    expect(f.port.conversation).not.toHaveBeenCalled();
  });
  it('rejects a provider reset for another live session, even if it has the selected agent ID', async () => {
    const f = fixture(); await f.pair();
    f.port.workspace.mockResolvedValue({ teams: workspace.teams, agents: [{ ...workspace.agents[0]!, backendSession: { kind: 'codex', threadId: 'current-thread' } }] });
    f.port.conversation.mockResolvedValue({ type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', threadId: 'other-thread', payload: { snapshot: {} } });
    await expect(f.gateway.request('phone', 'conversation.subscribe', { ...target, sessionId: JSON.stringify({ kind: 'codex', threadId: 'current-thread' }) })).rejects.toThrow('session mismatch');
  });
  it('admits concurrent retries once and reconciles accepted delivery across process restart', async () => {
    const f = fixture(); await f.pair();
    const command = { target, text: 'Reply once', clientCommandId: randomUUID() };
    const results = await Promise.all([f.gateway.request('phone', 'prompt.submit', command), f.gateway.request('phone', 'prompt.submit', command)]);
    expect(results).toEqual([expect.objectContaining({ state: 'accepted' }), expect.objectContaining({ state: 'accepted' })]);
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('agent', 'Reply once', 'mobile:phone');
    const restored = new CompanionGateway('host', f.saved(), f.port);
    expect(await restored.request('phone', 'command.status', { clientCommandId: command.clientCommandId })).toMatchObject({ state: 'accepted' });
    await restored.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    await expect(restored.request('phone', 'prompt.submit', { ...command, text: 'Changed' })).rejects.toThrow('reused');
  });
  it('never resubmits an admission with unknown provider outcome and rejects revoked/read-only peers', async () => {
    const f = fixture(); await f.pair(); f.port.submit.mockRejectedValue(new Error('lost receipt'));
    const command = { target, text: 'Reply', clientCommandId: randomUUID() };
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'unresolved' });
    await f.gateway.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    await f.gateway.revoke('phone');
    expect(f.port.revoked).toHaveBeenCalledWith('phone');
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    await f.pair(false);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID() })).rejects.toThrow('read-only');
  });
  it('does not grant or dispatch if durable storage rejects the write', async () => {
    const f = fixture(); f.port.save.mockRejectedValue(new Error('disk full'));
    await expect(f.pair()).rejects.toThrow('disk full');
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    f.port.save.mockImplementation(async () => {}); await f.pair();
    f.port.save.mockRejectedValue(new Error('disk full'));
    await expect(f.gateway.request('phone', 'prompt.submit', { target, text: 'Reply', clientCommandId: randomUUID() })).rejects.toThrow('disk full');
    expect(f.port.submit).not.toHaveBeenCalled();
  });
  it('routes remote projected IDs through the owning daemon and denies mismatched locations', async () => {
    const f = fixture(); await f.pair(true, ['remote-team']);
    const remote = { hostId: 'host', locationId: 'ssh-host', teamId: 'remote-team', agentId: 'remote-agent', sessionId: null };
    await f.gateway.request('phone', 'prompt.submit', { target: remote, text: 'Remote prompt', clientCommandId: randomUUID() });
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('remote-agent', 'Remote prompt', 'mobile:phone');
  });
});
