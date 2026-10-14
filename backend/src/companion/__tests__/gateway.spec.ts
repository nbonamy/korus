import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CompanionGateway, type GatewayState } from '../gateway';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import { opaquePath } from '@workspace/core/companion-projection';
import { createPairingExchange, normalizePairingCode, pairingChannel, pairingConfirmationsMatch } from '@workspace/core/companion-pairing';
const workspace: CompanionWorkspace = {
  teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }, { id: 'remote-team', name: 'Remote', agentIds: ['remote-agent'], remoteConnectionId: 'ssh-host' }],
  agents: [{ id: 'agent', name: 'Agent', teamId: 'team', folder: '/private', backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '', mcpSessionId: 'private-session' },
    { id: 'remote-agent', name: 'Remote', teamId: 'remote-team', folder: '/private', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' }],
};
const target = { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null };
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
/** The phone side of pairing: PAKE against the gateway, as the native connector performs it. */
async function claim(gateway: CompanionGateway, peerId: string, shown: string, name = 'Phone', typed = shown) {
  const code = normalizePairingCode(typed)!; const channel = pairingChannel(code);
  const exchange = createPairingExchange({ role: 'initiator', code, initiatorId: peerId, responderId: 'host' });
  const started = await gateway.request(peerId, 'pair.start', { channel, message: b64(exchange.message), name }) as { message: string; confirm: string };
  const confirmations = exchange.finish(unb64(started.message));
  return { confirmations, host: unb64(started.confirm), channel,
    confirm: () => gateway.request(peerId, 'pair.confirm', { channel, confirm: b64(confirmations.initiatorConfirm) }) as Promise<{ pendingId: string; state: string }> };
}
function fixture() {
  let now = 1;
  let saved: GatewayState = { grants: [], commands: {} };
  const port = { respondRequest: vi.fn(async () => {}), workspace: vi.fn(async () => workspace), conversation: vi.fn(), loadOlderHistory: vi.fn(async () => ({ hasOlder: false })), submit: vi.fn(async () => {}),
    models: vi.fn(async () => [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }]), selectModel: vi.fn(async () => {}),
    startReview: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), restart: vi.fn(async () => {}), createChat: vi.fn(async () => 'created'), createQuickChat: vi.fn(async () => 'quick'), setBackend: vi.fn(async () => {}), close: vi.fn(async () => {}),
    closePreview: vi.fn(async () => ({ isLinkedWorktree: true, branch: "feature", upstream: "origin/feature", hasChanges: true })), setApprovalPreset: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}),
    save: vi.fn(async (state: GatewayState) => { saved = structuredClone(state); }), revoked: vi.fn() };
  const gateway = new CompanionGateway('host', saved, port, () => now);
  return { gateway, port, advance: () => { now += 300_001; }, saved: () => saved,
    async pair() {
      const invite = gateway.invite();
      const result = await (await claim(gateway, 'phone', invite.code)).confirm();
      await gateway.decide(result.pendingId, true);
      return invite;
    } };
}
describe('companion authorization gateway', () => {
  it('routes answers only to the paired, current session and pending request identity', async () => {
    const f = fixture();
    const question = { id: 'q', conversationId: 'conversation', kind: 'question' as const, question: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [] } };
    f.port.workspace.mockResolvedValue({ ...workspace, agentRequests: { agent: [question] } });
    const reply = { target, id: 'q', conversationId: 'conversation', outcome: { kind: 'answered', answers: { choice: { answers: ['Keep the worktree'] } } } };
    await expect(f.gateway.request('phone', 'agent.request.respond', reply)).rejects.toThrow('authorized');
    await f.pair();
    for (const invalid of [
      { ...reply, target: { ...target, sessionId: 'old' } },
      { ...reply, conversationId: 'old-conversation' },
      { ...reply, id: 'missing' },
      { ...reply, agentId: 'remote-agent' },
      { ...reply, outcome: { kind: 'decision', decision: 'unrestricted' } },
      { ...reply, outcome: { kind: 'answered', answers: { choice: { answers: [42] } } } },
    ]) await expect(f.gateway.request('phone', 'agent.request.respond', invalid)).rejects.toThrow();
    expect(f.port.respondRequest).not.toHaveBeenCalled();
    await f.gateway.request('phone', 'agent.request.respond', reply);
    expect(f.port.respondRequest).toHaveBeenCalledExactlyOnceWith({ agentId: 'agent', id: 'q', outcome: reply.outcome });
    f.port.respondRequest.mockRejectedValueOnce(new Error('Already answered on desktop'));
    await expect(f.gateway.request('phone', 'agent.request.respond', reply)).rejects.toThrow('Already answered');
    await f.gateway.revoke('phone');
    await expect(f.gateway.request('phone', 'agent.request.respond', reply)).rejects.toThrow('authorized');
  });

  it('authorizes session actions against the selected session and requires explicit worktree deletion consent', async () => {
    const f = fixture();
    await expect(f.gateway.request('phone', 'agent.close.preview', target)).rejects.toThrow('authorized');
    await f.pair();
    expect(await f.gateway.request('phone', 'agent.close.preview', target)).toStrictEqual({ target, isLinkedWorktree: true, branch: 'feature', upstream: 'origin/feature', hasChanges: true });
    await f.gateway.request('phone', 'agent.restart', target);
    expect(f.port.restart).toHaveBeenCalledExactlyOnceWith('agent');
    await f.gateway.request('phone', 'agent.close', { target });
    expect(f.port.close).toHaveBeenLastCalledWith('agent', undefined);
    const input = { deleteWorktree: true, deleteRemoteBranch: false, discardChanges: true, confirmed: true };
    for (const invalid of [{ ...input, confirmed: false }, { ...input, confirmed: undefined }, { ...input, deleteRemoteBranch: 'yes' }, { ...input, path: '/arbitrary' }]) {
      await expect(f.gateway.request('phone', 'agent.close', { target, input: invalid })).rejects.toThrow();
    }
    expect(f.port.close).toHaveBeenCalledTimes(1);
    await f.gateway.request('phone', 'agent.close', { target, input });
    expect(f.port.close).toHaveBeenLastCalledWith('agent', input);
    for (const method of ['agent.restart', 'agent.close.preview', 'agent.close']) {
      const stale = { ...target, sessionId: 'another-session' };
      await expect(f.gateway.request('phone', method, method === 'agent.close' ? { target: stale, input } : stale)).rejects.toThrow('stale');
    }
    f.port.workspace.mockResolvedValue({ ...workspace, agents: [{ ...workspace.agents[0]!, status: { type: 'working' } }] });
    await expect(f.gateway.request('phone', 'agent.restart', target)).rejects.toThrow('Stop');
    expect(f.port.restart).toHaveBeenCalledTimes(1);
    await f.gateway.revoke('phone');
    await expect(f.gateway.request('phone', 'agent.close', { target, input })).rejects.toThrow('authorized');
    expect(f.port.close).toHaveBeenCalledTimes(2);
  });
  it('loads earlier history only for an approved current target and returns the authoritative conversation', async () => {
    const f = fixture();
    const frame = { type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'agent', payload: { snapshot: { messages: [] } } };
    f.port.conversation.mockResolvedValue(frame);
    await expect(f.gateway.request('phone', 'conversation.loadOlder', target)).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'conversation.loadOlder', { ...target, sessionId: 'stale' })).rejects.toThrow();
    expect(f.port.loadOlderHistory).not.toHaveBeenCalled();
    await expect(f.gateway.request('phone', 'conversation.loadOlder', target)).resolves.toEqual({ frame, hasOlder: false });
    expect(f.port.loadOlderHistory).toHaveBeenCalledExactlyOnceWith('agent');
    f.port.loadOlderHistory.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return { hasOlder: true }; });
    await expect(f.gateway.request('phone', 'conversation.loadOlder', target)).rejects.toThrow('authorized');
  });
  it('permits only pairing before explicit approval; rejects expiry, replay and a competing peer', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    const first = await claim(f.gateway, 'phone', invite.code);
    expect(pairingConfirmationsMatch(first.confirmations.responderConfirm, first.host)).toBe(true);
    const pending = await first.confirm();
    expect(pending.state).toBe('awaitingApproval');
    expect(await first.confirm()).toStrictEqual(pending);
    const competing = await claim(f.gateway, 'other-phone', invite.code);
    await expect(competing.confirm()).rejects.toThrow('claimed');
    await expect(f.gateway.request('other-phone', 'pair.status', { pendingId: pending.pendingId })).rejects.toThrow();
    await f.gateway.decide(pending.pendingId, true);
    await expect(claim(f.gateway, 'other-phone', invite.code)).rejects.toThrow('expired');
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: pending.pendingId })).toMatchObject({ state: 'approved' });
    const expired = f.gateway.invite(); f.advance();
    await expect(claim(f.gateway, 'phone', expired.code)).rejects.toThrow('expired');
  });
  it('lets a phone with the wrong code detect the mismatch itself and gives up after three attempts', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const wrong = `${invite.code.slice(0, 5)}${invite.code.slice(5).split('').reverse().join('')}`;
    const typo = wrong === invite.code ? `${invite.code.slice(0, 5)}AAAA` : wrong;
    for (let attempt = 0; attempt < 3; attempt++) {
      const mistaken = await claim(f.gateway, 'phone', invite.code, 'Phone', typo);
      expect(pairingConfirmationsMatch(mistaken.confirmations.responderConfirm, mistaken.host)).toBe(false);
    }
    await expect(claim(f.gateway, 'phone', invite.code)).rejects.toThrow('expired');
    expect(f.gateway.pairChannels()).toEqual([]);
  });
  it('burns the invitation when a peer answers its challenge incorrectly', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const attempt = await claim(f.gateway, 'phone', invite.code);
    await expect(f.gateway.request('phone', 'pair.confirm', { channel: attempt.channel, confirm: b64(new Uint8Array(32)) })).rejects.toThrow('expired');
    expect(f.gateway.pairChannels()).toEqual([]);
    await expect(attempt.confirm()).rejects.toThrow('expired');
    expect(f.gateway.pendingRequests).toEqual([]);
  });
  it('refuses a confirmation that was not preceded by a start from the same peer', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const attempt = await claim(f.gateway, 'phone', invite.code);
    await expect(f.gateway.request('intruder', 'pair.confirm', { channel: attempt.channel, confirm: b64(attempt.confirmations.initiatorConfirm) })).rejects.toThrow();
    expect(f.gateway.pendingRequests).toEqual([]);
  });
  it('advertises only live invitation channels and limits concurrent invitations', async () => {
    const f = fixture(); const invites = Array.from({ length: 5 }, () => f.gateway.invite());
    expect(f.gateway.pairChannels().sort()).toEqual(invites.map((invite) => invite.code.slice(0, 4)).sort());
    expect(() => f.gateway.invite()).toThrow('Too many');
    f.advance(); expect(f.gateway.pairChannels()).toEqual([]);
  });
  it('recovers an approved device pairing record without leaving a pending approval', async () => {
    const f = fixture(); await f.pair();
    const invite = f.gateway.invite();
    const result = await (await claim(f.gateway, 'phone', invite.code, 'Recovered phone')).confirm();
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: result.pendingId })).toMatchObject({ state: 'approved' });
    expect(f.gateway.pendingRequests).toEqual([]);
    await expect(claim(f.gateway, 'other-phone', invite.code)).rejects.toThrow('expired');
  });
  it('expires an unapproved request together with its invitation', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const { pendingId } = await (await claim(f.gateway, 'phone', invite.code)).confirm();
    f.advance();
    await expect(f.gateway.decide(pendingId, true)).rejects.toThrow('expired');
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
  it('projects every team without private agent fields and rejects forged location, team, session and raw RPC', async () => {
    const f = fixture(); await f.pair();
    const projected = await f.gateway.request('phone', 'snapshot.get', {}) as CompanionWorkspace;
    expect(projected.teams.map((team) => team.id)).toEqual(['team', 'remote-team']);
    expect(projected.agents.map((agent) => agent.id)).toEqual(['agent', 'remote-agent']);
    expect(projected.agents.every((agent) => /^\/[0-9a-f]{16}\/private$/.test(agent.folder ?? '') && !('mcpSessionId' in agent))).toBe(true);
    expect(JSON.stringify(projected)).not.toContain('"/private"');
    for (const forged of [{ ...target, hostId: 'other' }, { ...target, locationId: 'ssh-host' }, { ...target, teamId: 'remote-team' }, { ...target, sessionId: 'other' }]) {
      await expect(f.gateway.request('phone', 'conversation.subscribe', forged)).rejects.toThrow('stale');
    }
    await expect(f.gateway.request('phone', 'agent/git/push', {})).rejects.toThrow('supported');
    await expect(f.gateway.request('phone', 'snapshot.get', { _clientId: 'desktop' })).rejects.toThrow();
    expect(f.port.conversation).not.toHaveBeenCalled();
  });
  it('sends repository icons only when the phone does not already hold the current set', async () => {
    const f = fixture(); await f.pair();
    f.port.workspace.mockResolvedValue({ ...workspace, agents: [{ ...workspace.agents[0]!, workspace: { kind: 'git', folder: '/p', repositoryName: 'repo', repositoryRoot: '/p', primaryWorktreeRoot: '/p', branch: 'main', isLinkedWorktree: false, updatedAt: '' } }], repositoryIcons: { '/p': 'GEAR' } });
    const first = await f.gateway.request('phone', 'snapshot.get', {}) as { iconsVersion: string; repositoryIcons?: Record<string, string> };
    expect(Object.values(first.repositoryIcons!)).toEqual(['GEAR']);
    const again = await f.gateway.request('phone', 'snapshot.get', { iconsVersion: first.iconsVersion }) as typeof first;
    expect(again.repositoryIcons).toBeUndefined(); expect(again.iconsVersion).toBe(first.iconsVersion);
    f.port.workspace.mockResolvedValue({ ...workspace, repositoryIcons: {} });
    const changed = await f.gateway.request('phone', 'snapshot.get', { iconsVersion: first.iconsVersion }) as typeof first;
    expect(changed.repositoryIcons).toEqual({}); expect(changed.iconsVersion).not.toBe(first.iconsVersion);
  });
  it('lists models and saves a model choice only for agents the laptop shows', async () => {
    const f = fixture(); await f.pair();
    expect(await f.gateway.request('phone', 'models.list', { agentId: 'agent' })).toStrictEqual({ models: [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }] });
    expect(f.port.models).toHaveBeenCalledExactlyOnceWith('agent');
    await f.gateway.request('phone', 'agent.model.select', { agentId: 'agent', model: 'gpt', reasoningEffort: 'high', serviceTier: null });
    expect(f.port.selectModel).toHaveBeenCalledExactlyOnceWith('agent', { model: 'gpt', reasoningEffort: 'high', serviceTier: null });
    await expect(f.gateway.request('phone', 'models.list', { agentId: 'unknown' })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'agent.model.select', { agentId: 'unknown', model: 'gpt', reasoningEffort: null, serviceTier: null })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'agent.model.select', { agentId: 'agent', model: 'gpt', reasoningEffort: null, serviceTier: null, extra: 1 })).rejects.toThrow();
    await expect(f.gateway.request('stranger', 'models.list', { agentId: 'agent' })).rejects.toThrow('authorized');
  });
  it('lets the phone stop an agent and change its permissions, only for agents the laptop shows', async () => {
    const f = fixture(); await f.pair();
    await f.gateway.request('phone', 'agent.interrupt', { agentId: 'agent' });
    await f.gateway.request('phone', 'agent.approvalPreset.set', { agentId: 'agent', preset: 'full-access' });
    await f.gateway.request('phone', 'agent.permissionMode.set', { agentId: 'remote-agent', mode: 'acceptEdits' });
    expect(f.port.interrupt).toHaveBeenCalledExactlyOnceWith('agent');
    expect(f.port.setApprovalPreset).toHaveBeenCalledExactlyOnceWith('agent', 'full-access');
    expect(f.port.setPermissionMode).toHaveBeenCalledExactlyOnceWith('remote-agent', 'acceptEdits');
    for (const [method, args] of [['agent.interrupt', {}], ['agent.approvalPreset.set', { preset: 'x' }], ['agent.permissionMode.set', { mode: 'x' }]] as const) {
      await expect(f.gateway.request('phone', method, { agentId: 'unknown', ...args })).rejects.toThrow('stale');
      await expect(f.gateway.request('stranger', method, { agentId: 'agent', ...args })).rejects.toThrow('authorized');
    }
    await expect(f.gateway.request('phone', 'agent.permissionMode.set', { agentId: 'agent', mode: 'x', extra: 1 })).rejects.toThrow();
  });
  it('starts a review for a shown agent with a validated scope, and passes delegation choices with a prompt', async () => {
    const f = fixture(); await f.pair();
    const input = { scope: { type: 'branch', baseRef: 'main' }, threadMode: 'independent', instructions: 'Focus on security' };
    await f.gateway.request('phone', 'agent.review.start', { agentId: 'agent', input });
    expect(f.port.startReview).toHaveBeenCalledExactlyOnceWith('agent', input);
    await expect(f.gateway.request('phone', 'agent.review.start', { agentId: 'unknown', input })).rejects.toThrow('stale');
    await expect(f.gateway.request('stranger', 'agent.review.start', { agentId: 'agent', input })).rejects.toThrow('authorized');
    for (const bad of [{ ...input, scope: { type: 'branch' } }, { ...input, threadMode: 'both' }, { ...input, backend: 'claude' }]) {
      await expect(f.gateway.request('phone', 'agent.review.start', { agentId: 'agent', input: bad })).rejects.toThrow();
    }
    const delegation = { startingContext: 'handoff', instructions: 'Run the focused tests' };
    await f.gateway.request('phone', 'prompt.submit', { target, text: '/delegate', clientCommandId: randomUUID(), options: { delegation } });
    expect(f.port.submit).toHaveBeenLastCalledWith('agent', '/delegate', 'mobile:phone', { delegation });
    await expect(f.gateway.request('phone', 'prompt.submit', { target, text: '/delegate', clientCommandId: randomUUID(), options: { delegation: { startingContext: 'copy' } } })).rejects.toThrow();
  });
  it('forwards composer options with a prompt and treats different options as a different command', async () => {
    const f = fixture(); await f.pair();
    const command = { target, text: 'Plan it', clientCommandId: randomUUID(), options: { model: 'gpt', reasoningEffort: 'high', serviceTier: null, planMode: true } };
    await f.gateway.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('agent', 'Plan it', 'mobile:phone', command.options);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, options: { ...command.options, planMode: false } })).rejects.toThrow('reused');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), options: { cwd: '/etc' } })).rejects.toThrow();
  });
  it('hands phone attachments to the laptop with the prompt and rejects oversized or malformed ones', async () => {
    const f = fixture(); await f.pair();
    const photo = { type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') };
    const command = { target, text: '', clientCommandId: randomUUID(), attachments: [photo] };
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'accepted' });
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('agent', '', 'mobile:phone', undefined, [{ ...photo, data: Buffer.from('jpeg') }]);
    // The ledger keeps a fingerprint, never the bytes.
    expect(JSON.stringify(f.saved())).not.toContain(photo.data);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), text: '', attachments: [] })).rejects.toThrow('text or an attachment');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [{ ...photo, data: 'not base64!' }] })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [{ ...photo, data: Buffer.alloc(2_600_000).toString('base64') }] })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: Array(6).fill(photo) })).rejects.toThrow();
  });
  it('rejects a provider reset for another live session, even if it has the selected agent ID', async () => {
    const f = fixture(); await f.pair();
    f.port.workspace.mockResolvedValue({ teams: workspace.teams, agents: [{ ...workspace.agents[0]!, backendSession: { kind: 'codex', threadId: 'current-thread' } }] });
    f.port.conversation.mockResolvedValue({ type: 'codex.conversationSnapshotChanged', agentId: 'agent', backend: 'codex', threadId: 'other-thread', payload: { snapshot: {} } });
    await expect(f.gateway.request('phone', 'conversation.subscribe', { ...target, sessionId: JSON.stringify({ kind: 'codex', threadId: 'current-thread' }) })).rejects.toThrow('session mismatch');
  });
  it('serves a Claude conversation whose session id was rebound mid-conversation', async () => {
    const f = fixture(); await f.pair();
    const claude = { ...workspace.agents[1]!, backendSession: { kind: 'claude', sessionId: 'resumed-session' } } as unknown as typeof workspace.agents[number];
    f.port.workspace.mockResolvedValue({ teams: workspace.teams, agents: [workspace.agents[0]!, claude] });
    f.port.conversation.mockResolvedValue({ type: 'claude.conversationSnapshotChanged', agentId: 'remote-agent', backend: 'claude', payload: { revision: 4, snapshot: { sessionId: 'forked-session', messages: [] } } });
    const remote = { hostId: 'host', locationId: 'ssh-host', teamId: 'remote-team', agentId: 'remote-agent', sessionId: JSON.stringify({ kind: 'claude', sessionId: 'resumed-session' }) };
    expect(await f.gateway.request('phone', 'conversation.subscribe', remote)).toMatchObject({ payload: { revision: 4 } });
    f.port.conversation.mockResolvedValue({ type: 'codex.conversationSnapshotChanged', agentId: 'remote-agent', backend: 'claude', payload: { revision: 5, snapshot: {} } });
    await expect(f.gateway.request('phone', 'conversation.subscribe', remote)).rejects.toThrow('session mismatch');
  });
  it('admits concurrent retries once and reconciles accepted delivery across process restart', async () => {
    const f = fixture(); await f.pair();
    const command = { target, text: 'Reply once', clientCommandId: randomUUID() };
    const results = await Promise.all([f.gateway.request('phone', 'prompt.submit', command), f.gateway.request('phone', 'prompt.submit', command)]);
    expect(results).toEqual([expect.objectContaining({ state: 'accepted' }), expect.objectContaining({ state: 'accepted' })]);
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('agent', 'Reply once', 'mobile:phone', undefined);
    const restored = new CompanionGateway('host', f.saved(), f.port);
    expect(await restored.request('phone', 'command.status', { clientCommandId: command.clientCommandId })).toMatchObject({ state: 'accepted' });
    await restored.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    await expect(restored.request('phone', 'prompt.submit', { ...command, text: 'Changed' })).rejects.toThrow('reused');
  });
  it('never resubmits an admission with unknown provider outcome and rejects revoked peers', async () => {
    const f = fixture(); await f.pair(); f.port.submit.mockRejectedValue(new Error('lost receipt'));
    const command = { target, text: 'Reply', clientCommandId: randomUUID() };
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'unresolved' });
    await f.gateway.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    await f.gateway.revoke('phone');
    expect(f.port.revoked).toHaveBeenCalledWith('phone');
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID() })).rejects.toThrow('authorized');
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
    const f = fixture(); await f.pair();
    const remote = { hostId: 'host', locationId: 'ssh-host', teamId: 'remote-team', agentId: 'remote-agent', sessionId: null };
    await f.gateway.request('phone', 'prompt.submit', { target: remote, text: 'Remote prompt', clientCommandId: randomUUID() });
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith('remote-agent', 'Remote prompt', 'mobile:phone', undefined);
  });
  describe('starting a chat in a repository', () => {
    const repository = { kind: 'git' as const, folder: '/code/repo', repositoryName: 'repo', repositoryRoot: '/code/repo', primaryWorktreeRoot: '/code/repo', branch: 'main', defaultBranch: 'main', isLinkedWorktree: false, updatedAt: '' };
    const repositoryId = opaquePath('/code/repo');
    async function ready() {
      const f = fixture(); await f.pair();
      f.port.workspace.mockResolvedValue({ ...workspace, backends: { team: ['codex', 'claude'], 'remote-team': ['claude'] },
        agents: [{ ...workspace.agents[0]!, workspace: repository }, { ...workspace.agents[1]!, workspace: { ...repository, repositoryRoot: '/srv/remote', primaryWorktreeRoot: '/srv/remote', repositoryName: 'remote-repo' } }] });
      return f;
    }
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
    it('creates in the default checkout or in a new worktree, with real paths the phone never saw', async () => {
      const f = await ready();
      const { creationId } = await f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude' }) as { creationId: string };
      expect(f.port.createChat).toHaveBeenCalledWith({ teamId: 'team', backend: 'claude', repositoryName: 'repo', repositoryRoot: '/code/repo', defaultBranch: 'main' });
      await settled();
      expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'created' });
      await f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'codex', worktree: { branchName: 'feature/login' } });
      expect(f.port.createChat).toHaveBeenLastCalledWith(expect.objectContaining({ backend: 'codex', worktree: { branchName: 'feature/login' } }));
    });
    it('places a chat of a remote team on its own laptop', async () => {
      const f = await ready();
      await f.gateway.request('phone', 'agent.create', { teamId: 'remote-team', repositoryId: opaquePath('/srv/remote'), backend: 'claude' });
      expect(f.port.createChat).toHaveBeenCalledWith(expect.objectContaining({ remoteConnectionId: 'ssh-host', repositoryRoot: '/srv/remote' }));
    });
    it.each([
      ['an unknown repository', { repositoryId: 'nope' }],
      ['a repository of another team', { teamId: 'remote-team' }],
      ['an unknown team', { teamId: 'ghost' }],
      ['an engine the team cannot use', { teamId: 'remote-team', repositoryId: opaquePath('/srv/remote'), backend: 'codex' }],
      ['an unsupported engine', { backend: 'other' }],
      ...['', '-rf', '../x', 'a..b', 'a b', 'a/', 'x.lock', 'a//b', '/abs'].map((branchName): [string, object] => [`the branch ${JSON.stringify(branchName)}`, { worktree: { branchName } }]),
      ['an extra field', { folder: '/etc' }],
    ] satisfies [string, object][])('rejects %s', async (_name: string, change: object) => {
      const f = await ready();
      await expect(f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude', ...change })).rejects.toThrow();
      expect(f.port.createChat).not.toHaveBeenCalled();
    });
    it('needs a paired phone, reports a failure, and answers only the phone that started it', async () => {
      const f = await ready();
      await expect(f.gateway.request('stranger', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude' })).rejects.toThrow('authorized');
      f.port.createChat.mockRejectedValueOnce(new Error('Branch exists'));
      const { creationId } = await f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude' }) as { creationId: string };
      await settled();
      expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'error', error: 'Branch exists' });
      await expect(f.gateway.request('stranger', 'agent.create.status', { creationId })).rejects.toThrow('authorized');
      await expect(f.gateway.request('phone', 'agent.create.status', { creationId: randomUUID() })).rejects.toThrow('not found');
    });
    it('caps the creations a phone runs at once', async () => {
      const f = await ready();
      f.port.createChat.mockImplementation(() => new Promise(() => {}));
      for (let index = 0; index < 3; index++) await f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude' });
      await expect(f.gateway.request('phone', 'agent.create', { teamId: 'team', repositoryId, backend: 'claude' })).rejects.toThrow('Too many');
    });
  });
  describe('choosing the engine of an empty chat', () => {
    async function ready(change: object = {}) {
      const f = fixture(); await f.pair();
      f.port.workspace.mockResolvedValue({ ...workspace, backends: { team: ['codex', 'claude'] }, agents: [{ ...workspace.agents[0]!, ...change }, workspace.agents[1]!] });
      return f;
    }
    it('switches an agent that has not started yet', async () => {
      const f = await ready();
      await f.gateway.request('phone', 'agent.backend.set', { agentId: 'agent', backend: 'claude' });
      expect(f.port.setBackend).toHaveBeenCalledExactlyOnceWith('agent', 'claude');
    });
    it.each([
      ['a chat that already has a conversation', { backendSession: { kind: 'codex', threadId: 'thread' } }, 'claude'],
      ['a chat that has sent a prompt', { hasSubmittedPrompt: true }, 'claude'],
      ['a chat that is working', { status: { type: 'working' } }, 'claude'],
      ['an engine the laptop cannot use', {}, 'antigravity'],
    ])('refuses %s', async (_name, change, backend) => {
      const f = await ready(change);
      await expect(f.gateway.request('phone', 'agent.backend.set', { agentId: 'agent', backend })).rejects.toThrow();
      await expect(f.gateway.request('phone', 'agent.backend.set', { agentId: 'ghost', backend: 'claude' })).rejects.toThrow('not found');
      expect(f.port.setBackend).not.toHaveBeenCalled();
    });
    it('needs a paired phone', async () => {
      const f = fixture();
      await expect(f.gateway.request('stranger', 'agent.backend.set', { agentId: 'agent', backend: 'claude' })).rejects.toThrow('authorized');
    });
  });
  describe('starting a quick chat', () => {
    async function ready() {
      const f = fixture(); await f.pair();
      f.port.workspace.mockResolvedValue({ ...workspace, backends: { team: ['codex', 'claude'], 'remote-team': ['claude'] } });
      return f;
    }
    it('creates one for a team and reports it like any other new chat', async () => {
      const f = await ready();
      const { creationId } = await f.gateway.request('phone', 'agent.quickChat.create', { teamId: 'team', backend: 'claude' }) as { creationId: string };
      expect(f.port.createQuickChat).toHaveBeenCalledExactlyOnceWith({ teamId: 'team', backend: 'claude' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await f.gateway.request('phone', 'agent.create.status', { creationId })).toStrictEqual({ state: 'success', agentId: 'quick' });
    });
    it.each([
      ['an unknown team', { teamId: 'ghost', backend: 'claude' }],
      ['an engine the team cannot use', { teamId: 'remote-team', backend: 'codex' }],
      ['an unsupported engine', { teamId: 'team', backend: 'other' }],
      ['an extra field', { teamId: 'team', backend: 'claude', folder: '/etc' }],
    ])('refuses %s', async (_name, input) => {
      const f = await ready();
      await expect(f.gateway.request('phone', 'agent.quickChat.create', input)).rejects.toThrow();
      expect(f.port.createQuickChat).not.toHaveBeenCalled();
    });
    it('needs a paired phone', async () => {
      await expect(fixture().gateway.request('stranger', 'agent.quickChat.create', { teamId: 'team', backend: 'claude' })).rejects.toThrow('authorized');
    });
  });
});
