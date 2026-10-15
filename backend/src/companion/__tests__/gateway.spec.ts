import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CompanionGateway, companionAgentMethods, type GatewayState } from '../gateway';
import { companionSessionId, type CompanionTarget, type CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { BackendSkillSummary } from '@workspace/core/contracts';
import { opaquePath } from '@workspace/core/companion-projection';
import { normalizePairingCode } from '@workspace/core/companion-pairing';
const workspace: CompanionWorkspace = {
  teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }, { id: 'remote-team', name: 'Remote', agentIds: ['remote-agent'], remoteConnectionId: 'ssh-host' }],
  agents: [{ id: 'agent', name: 'Agent', teamId: 'team', folder: '/private', backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '', mcpSessionId: 'private-session' },
    { id: 'remote-agent', name: 'Remote', teamId: 'remote-team', folder: '/private', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' }],
};
const target = { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null };
function claim(gateway: CompanionGateway, peerId: string, shown: string, name = 'Phone') {
  return gateway.request(peerId, 'pair.claim', { code: normalizePairingCode(shown)!, name }) as Promise<{ pendingId: string; state: string }>;
}
function fixture() {
  let now = 1;
  let saved: GatewayState = { grants: [], commands: {} };
  const port = { onEvent: () => () => {}, push: vi.fn(async (_peerId: string, _registration: unknown, _notification: unknown) => 'sent' as const), changeGoal: vi.fn(async () => {}), markRead: vi.fn(async () => {}), respondRequest: vi.fn(async () => {}), workspace: vi.fn(async () => workspace), conversation: vi.fn(), loadOlderHistory: vi.fn(async (): Promise<import('@workspace/core/backend-driver').BackendHistoryLoadResult> => ({ hasOlder: false })), readConversationContent: vi.fn(async () => ({ data: 'e30=', totalBytes: 2, nextOffset: null })), submit: vi.fn(async () => {}),
    models: vi.fn(async () => [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }]), selectModel: vi.fn(async () => {}),
    readImage: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,cG5n' })),
    plugins: vi.fn(async () => [{ id: 'github@bundled', name: 'github', displayName: 'GitHub', enabled: true }]),
    skills: vi.fn(async (): Promise<BackendSkillSummary[]> => [{ name: 'review', path: '/skills/review/SKILL.md', enabled: true }]),
    reviewSetup: vi.fn<() => Promise<import('@workspace/core/companion-review').CompanionReviewSetup>>(),
    startReview: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), restart: vi.fn(async () => {}), branches: async () => [], createChat: vi.fn(async () => 'created'), createQuickChat: vi.fn(async () => 'quick'), setBackend: vi.fn(async () => {}), close: vi.fn(async () => {}),
    closePreview: vi.fn(async () => ({ isLinkedWorktree: true, branch: "feature", upstream: "origin/feature", hasChanges: true })), setApprovalPreset: vi.fn(async () => {}), setPermissionMode: vi.fn(async () => {}),
    save: vi.fn(async (state: GatewayState) => { saved = structuredClone(state); }), revoked: vi.fn() };
  const gateway = new CompanionGateway('host', saved, port, () => now);
  return { gateway, port, advance: () => { now += 300_001; }, saved: () => saved,
    async pair() {
      const invite = gateway.invite();
      const result = await claim(gateway, 'phone', invite.code);
      await gateway.decide(result.pendingId, true);
      return invite;
    } };
}
describe('companion authorization gateway', () => {
  it('reads only images referenced by the current conversation and rechecks the grant after reading', async () => {
    const f = fixture(); await f.pair();
    f.port.conversation.mockResolvedValue({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'agent', payload: { snapshot: { messages: [
      { id: 'screenshots', role: 'assistant', parts: [{ type: 'text', text: '[Screenshot](</tmp/phone shot.png>)' }] },
    ] } } });
    const input = { target, path: '/tmp/phone shot.png' };
    expect(await f.gateway.request('phone', 'conversation.image.read', input)).toStrictEqual({ dataUrl: 'data:image/png;base64,cG5n' });
    expect(f.port.readImage).toHaveBeenCalledExactlyOnceWith('agent', input.path);
    await expect(f.gateway.request('phone', 'conversation.image.read', { target, path: '/tmp/other.png' })).rejects.toThrow();
    expect(f.port.readImage).toHaveBeenCalledTimes(1);
    let release!: () => void;
    f.port.readImage.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { dataUrl: 'data:image/png;base64,cG5n' }; });
    const loading = f.gateway.request('phone', 'conversation.image.read', input);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await f.gateway.revoke('phone'); release();
    await expect(loading).rejects.toThrow('not authorized');
  });
  it.each(['validation', 'saving', 'queued'] as const)('reports pending before admission finishes %s and deduplicates retries', async phase => {
    const f = fixture(); await f.pair();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    let blocking: Promise<unknown> | undefined;
    if (phase === 'validation') f.port.workspace.mockImplementationOnce(async () => { entered = true; await gate; return workspace; });
    else f.port.save.mockImplementationOnce(async () => { entered = true; await gate; });
    if (phase === 'queued') {
      blocking = f.gateway.request('phone', 'notifications.register', null);
      await vi.waitFor(() => expect(entered).toBe(true));
    }
    const command = { target, text: 'Only once', clientCommandId: randomUUID() };
    const first = f.gateway.request('phone', 'prompt.submit', command);
    const retry = f.gateway.request('phone', 'prompt.submit', command);
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      expect(await f.gateway.request('phone', 'command.status', { clientCommandId: command.clientCommandId }))
        .toStrictEqual({ target, clientCommandId: command.clientCommandId, state: 'pending' });
      await expect(f.gateway.request('phone', 'prompt.submit', { ...command, text: 'Changed' })).rejects.toThrow('reused');
    } finally { release(); await blocking; await Promise.all([first, retry]); }
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    expect(await f.gateway.request('phone', 'command.status', { clientCommandId: command.clientCommandId }))
      .toStrictEqual({ target, clientCommandId: command.clientCommandId, state: 'accepted' });
  });

  it('retires pre-dispatch admission tracking after a failed receipt save', async () => {
    const f = fixture(); await f.pair();
    f.port.save.mockRejectedValueOnce(new Error('Disk unavailable'));
    const command = { target, text: 'Not sent', clientCommandId: randomUUID() };
    await expect(f.gateway.request('phone', 'prompt.submit', command)).rejects.toThrow('Disk unavailable');
    expect(f.port.submit).not.toHaveBeenCalled();
    expect(await f.gateway.request('phone', 'command.status', { clientCommandId: command.clientCommandId }))
      .toStrictEqual({ clientCommandId: command.clientCommandId, state: 'notReceived' });
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'accepted' });
    expect(f.port.submit).toHaveBeenCalledTimes(1);
  });

  it('uses the live foreground stream instead of push, independently per phone, and resumes push on close or stale heartbeat', async () => {
    const f = fixture(); await f.pair();
    const invite = f.gateway.invite(); const second = await claim(f.gateway, 'other', invite.code);
    await f.gateway.decide(second.pendingId, true);
    for (const peer of ['phone', 'other']) await f.gateway.request(peer, 'notifications.register', { token: 'ab'.repeat(32), environment: 'development' });
    const updates = vi.fn(); const subscription = f.gateway.subscribe('phone', updates, vi.fn());
    const notification = { id: 'event', target, name: 'Agent', kind: 'completed' as const, createdAt: 1 };
    try {
      await subscription.request('snapshot.get', { notifications: true });
      await f.gateway.notify(notification);
      expect(updates).toHaveBeenCalledWith({ type: 'notification', notification });
      expect(f.port.push.mock.calls.map(call => call[0])).toStrictEqual(['other']);
      f.port.push.mockClear();
      await f.gateway.notify({ ...notification, id: 'desktop-focused' }, async () => false);
      expect(updates).toHaveBeenCalledWith({ type: 'notification', notification: { ...notification, id: 'desktop-focused' } });
      expect(f.port.push).not.toHaveBeenCalled();
      f.advance();
      await f.gateway.notify({ ...notification, id: 'stale' });
      expect(f.port.push).toHaveBeenCalledTimes(2);
      f.port.push.mockClear(); await subscription.request('ping', {});
      await f.gateway.notify({ ...notification, id: 'renewed' });
      expect(f.port.push.mock.calls.map(call => call[0])).toStrictEqual(['other']);
      f.port.push.mockClear(); subscription.close();
      await f.gateway.notify({ ...notification, id: 'closed' });
      expect(f.port.push).toHaveBeenCalledTimes(2);
    } finally { subscription.close(); }
  });

  it('persists push registration only for its authenticated phone and revokes both delivery paths', async () => {
    const f = fixture();
    const registration = { token: 'ab'.repeat(32), environment: 'development' };
    await expect(f.gateway.request('phone', 'notifications.register', registration)).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'notifications.register', { ...registration, token: 'bad' })).rejects.toThrow();
    await f.gateway.request('phone', 'notifications.register', registration);
    expect(f.saved().push?.phone).toStrictEqual(registration);
    await f.gateway.request('phone', 'notifications.register', null);
    expect(f.saved().push?.phone).toBeUndefined();
    await f.gateway.request('phone', 'notifications.register', registration);
    await f.gateway.revoke('phone');
    expect(f.saved().push?.phone).toBeUndefined();
  });

  it('revokes a device while its prompt is still waiting on the provider, and answers a retry with the final outcome', async () => {
    const f = fixture();
    await f.pair();
    let admit!: () => void;
    f.port.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { admit = resolve; }));
    const command = { target, text: 'hello', clientCommandId: randomUUID() };
    const first = f.gateway.request('phone', 'prompt.submit', command);
    await vi.waitFor(() => expect(f.port.submit).toHaveBeenCalled());
    await f.gateway.revoke('phone');
    expect(f.port.revoked).toHaveBeenCalledWith('phone');
    admit();
    expect(await first).toMatchObject({ state: 'accepted' });
    expect(f.saved().commands).toStrictEqual({});
  });

  it('lets a retry wait for an in-flight prompt instead of reporting it unresolved', async () => {
    const f = fixture();
    await f.pair();
    let admit!: () => void;
    f.port.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { admit = resolve; }));
    const command = { target, text: 'hello', clientCommandId: randomUUID() };
    const first = f.gateway.request('phone', 'prompt.submit', command);
    await vi.waitFor(() => expect(f.port.submit).toHaveBeenCalled());
    expect(await f.gateway.request('phone', 'command.status', { clientCommandId: command.clientCommandId })).toMatchObject({ state: 'pending' });
    const retry = f.gateway.request('phone', 'prompt.submit', command);
    admit();
    expect(await retry).toMatchObject({ state: 'accepted' });
    expect(await first).toMatchObject({ state: 'accepted' });
    expect(f.port.submit).toHaveBeenCalledTimes(1);
  });

  it('requires an authorized current target and a supported provider for goal mutations', async () => {
    const f = fixture();
    await expect(f.gateway.request('stranger', 'agent.goal.set', { target, objective: 'Ship' })).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'agent.goal.set', { target: { ...target, sessionId: 'stale' }, objective: null })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'agent.goal.set', { target, objective: '  ' })).rejects.toThrow();
    f.port.workspace.mockResolvedValueOnce({ ...workspace, agents: [{ ...workspace.agents[0]!, backend: 'antigravity' }] });
    await expect(f.gateway.request('phone', 'agent.goal.set', { target, objective: 'Ship' })).rejects.toThrow('unavailable');
    expect(f.port.changeGoal).not.toHaveBeenCalled();
    f.port.workspace.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return workspace; });
    await expect(f.gateway.request('phone', 'agent.goal.set', { target, objective: 'Ship' })).rejects.toThrow('authorized');
    expect(f.port.changeGoal).not.toHaveBeenCalled();
  });

  it('binds review setup and launch to the original conversation and rechecks a revoked grant after discovery', async () => {
    const f = fixture(); await f.pair();
    const setup = { target, branch: null, baseRef: null, uncommitted: true, branchChanges: false, currentThread: false, activeReview: false, reviewerAgentId: null,
      agentBackend: 'codex' as const, backend: 'codex' as const, backends: ['codex' as const], models: [] };
    f.port.reviewSetup.mockResolvedValue(setup);
    expect(await f.gateway.request('phone', 'agent.review.setup', { target })).toStrictEqual(setup);
    await expect(f.gateway.request('phone', 'agent.review.start', { target: { ...target, sessionId: 'old' }, input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } })).rejects.toThrow('stale');
    expect(f.port.startReview).not.toHaveBeenCalled();
    f.port.reviewSetup.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return setup; });
    await expect(f.gateway.request('phone', 'agent.review.setup', { target })).rejects.toThrow('authorized');
  });
  it('accepts read receipts only from an approved device for its current target', async () => {
    const f = fixture();
    await expect(f.gateway.request('phone', 'conversation.read', { target, revision: 2 })).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'conversation.read', { target: { ...target, sessionId: 'old' }, revision: 2 })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'conversation.read', { target, revision: -1 })).rejects.toThrow();
    expect(f.port.markRead).not.toHaveBeenCalled();
    await f.gateway.request('phone', 'conversation.read', { target, revision: 2 });
    expect(f.port.markRead).toHaveBeenCalledExactlyOnceWith('agent', 2);
  });
  it('returns a Claude page directly and checks content reads again after revocation or session changes', async () => {
    const f = fixture();
    const backendSession = { kind: 'claude' as const, sessionId: 'claude-session', transport: 'stdio' as const };
    const claudeWorkspace = { ...workspace, agents: [{ ...workspace.agents[0]!, backend: 'claude' as const, backendSession }] };
    f.port.workspace.mockResolvedValue(claudeWorkspace);
    const currentTarget = { ...target, sessionId: JSON.stringify({ kind: 'claude', sessionId: backendSession.sessionId }) };
    const frame: NonNullable<import('@workspace/core/backend-driver').BackendHistoryLoadResult['frame']> = { type: 'claude.conversationEventReceived', agentId: 'agent', backend: 'claude', seq: 2, occurredAt: '', payload: { revision: 2, event: { seq: 2, occurredAt: '', backend: 'claude', agentId: 'agent', backendSessionId: backendSession.sessionId, type: 'history.prepended', payload: { messages: [], hasOlder: false } } } };
    f.port.loadOlderHistory.mockResolvedValue({ frame, hasOlder: false });
    const input = { sessionId: backendSession.sessionId, contentId: 'a'.repeat(64), offset: 0 };
    await expect(f.gateway.request('phone', 'conversation.content.read', { target: currentTarget, input })).rejects.toThrow('authorized');
    await f.pair();
    expect(await f.gateway.request('phone', 'conversation.loadOlder', currentTarget)).toStrictEqual({ frame, hasOlder: false });
    expect(f.port.conversation).not.toHaveBeenCalled();
    expect(await f.gateway.request('phone', 'conversation.content.read', { target: currentTarget, input })).toStrictEqual({ data: 'e30=', totalBytes: 2, nextOffset: null });
    await expect(f.gateway.request('phone', 'conversation.content.read', { target: currentTarget, input: { ...input, offset: -1 } })).rejects.toThrow();
    f.port.readConversationContent.mockImplementationOnce(async () => {
      f.port.workspace.mockResolvedValue({ ...claudeWorkspace, agents: [{ ...claudeWorkspace.agents[0]!, backendSession: { ...backendSession, sessionId: 'new' } }] });
      return { data: 'e30=', totalBytes: 2, nextOffset: null };
    });
    await expect(f.gateway.request('phone', 'conversation.content.read', { target: currentTarget, input })).rejects.toThrow('stale');
    f.port.workspace.mockResolvedValue(claudeWorkspace);
    f.port.readConversationContent.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return { data: 'e30=', totalBytes: 2, nextOffset: null }; });
    await expect(f.gateway.request('phone', 'conversation.content.read', { target: currentTarget, input })).rejects.toThrow('authorized');
  });
  it('lists plugins only for the paired current target and rechecks identity after lookup', async () => {
    const f = fixture();
    await expect(f.gateway.request('phone', 'plugins.list', target)).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'plugins.list', { ...target, sessionId: 'old' })).rejects.toThrow('stale');
    expect(await f.gateway.request('phone', 'plugins.list', target)).toStrictEqual({ plugins: [{ id: 'github@bundled', name: 'github', displayName: 'GitHub', enabled: true }] });
    expect(f.port.plugins).toHaveBeenCalledExactlyOnceWith('agent');
    f.port.plugins.mockImplementationOnce(async () => {
      f.port.workspace.mockResolvedValue({ ...workspace, agents: [{ ...workspace.agents[0]!, folder: '/changed' }] });
      return [];
    });
    await expect(f.gateway.request('phone', 'plugins.list', target)).rejects.toThrow('stale');
    f.port.workspace.mockResolvedValue(workspace);
    f.port.plugins.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return []; });
    await expect(f.gateway.request('phone', 'plugins.list', target)).rejects.toThrow('authorized');
  });

  it('lists skills for the current target and admits only enabled catalog references with prompts', async () => {
    const f = fixture();
    const skill = { name: 'review', path: '/skills/review/SKILL.md' };
    await expect(f.gateway.request('phone', 'skills.list', target)).rejects.toThrow('authorized');
    await f.pair();
    await expect(f.gateway.request('phone', 'skills.list', { ...target, sessionId: 'old' })).rejects.toThrow('stale');
    expect(await f.gateway.request('phone', 'skills.list', target)).toStrictEqual({ skills: [{ ...skill, enabled: true }] });
    expect(f.port.skills).toHaveBeenCalledExactlyOnceWith('agent');
    const command = { target, text: '$review', clientCommandId: randomUUID(), options: { skills: [skill] } };
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, options: { skills: [{ ...skill, path: '/private/other.md' }] } })).rejects.toThrow('Skill');
    expect(f.port.submit).not.toHaveBeenCalled();
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'accepted' });
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith(target, '$review', 'mobile:phone', command.options);
    f.port.skills.mockResolvedValue([{ ...skill, enabled: false }]);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID() })).rejects.toThrow('Skill');
    // A receipt lookup stays idempotent even if the skill has since been disabled.
    await f.gateway.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    f.port.skills.mockImplementationOnce(async () => { await f.gateway.revoke('phone'); return [{ ...skill, enabled: true }]; });
    await expect(f.gateway.request('phone', 'skills.list', target)).rejects.toThrow('authorized');
  });

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

  it.each([
    ['answers a request', 'agent.request.respond', 'respondRequest'],
    ['changes the engine', 'agent.backend.set', 'setBackend'],
  ] as const)('never %s for a device revoked during any workspace read', async (_name, method, effect) => {
    const question = { id: 'q', conversationId: 'conversation', kind: 'question' as const, question: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [] } };
    const current = { ...workspace, backends: { team: ['codex' as const, 'claude' as const] }, agentRequests: { agent: [question] } };
    const args = method === 'agent.request.respond' ? { target, id: 'q', conversationId: 'conversation', outcome: { kind: 'cancelled' } } : { target, backend: 'claude' };
    for (const revokedOnRead of [1, 2, 3]) {
      const f = fixture(); await f.pair();
      let reads = 0; let revoked = false;
      f.port.workspace.mockImplementation(async () => {
        if (++reads === revokedOnRead) { await f.gateway.revoke('phone'); revoked = true; }
        return current;
      });
      await f.gateway.request('phone', method, args).catch(() => {});
      expect(f.port[effect]).toHaveBeenCalledTimes(revoked ? 0 : 1);
    }
  });
  describe('every agent operation', () => {
    const question = { id: 'q', conversationId: 'conversation', kind: 'question' as const, question: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [] } };
    const claude = { backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session' } };
    type Row = { args: (target: CompanionTarget) => object; effect: 'readImage' | 'markRead' | 'conversation' | 'loadOlderHistory' | 'readConversationContent' | 'respondRequest' | 'skills' | 'plugins' | 'models' | 'selectModel' | 'interrupt' | 'setApprovalPreset' | 'setPermissionMode' | 'changeGoal' | 'setBackend' | 'restart' | 'closePreview' | 'close' | 'reviewSetup' | 'startReview'; read?: true; agent?: object };
    const rows: Record<string, Row> = {
      'conversation.read': { args: (t) => ({ target: t, revision: 1 }), effect: 'markRead' },
      'conversation.subscribe': { args: (t) => t, effect: 'conversation', read: true },
      'conversation.image.read': { args: t => ({ target: t, path: '/tmp/shot.png' }), effect: 'readImage', read: true },
      'conversation.loadOlder': { args: (t) => t, effect: 'loadOlderHistory', read: true },
      'conversation.content.read': { args: (t) => ({ target: t, input: { sessionId: 'session', contentId: 'a'.repeat(64), offset: 0 } }), effect: 'readConversationContent', read: true, agent: claude },
      'agent.request.respond': { args: (t) => ({ target: t, id: 'q', conversationId: 'conversation', outcome: { kind: 'cancelled' } }), effect: 'respondRequest' },
      'skills.list': { args: (t) => t, effect: 'skills', read: true },
      'plugins.list': { args: (t) => t, effect: 'plugins', read: true },
      'models.list': { args: (t) => t, effect: 'models', read: true },
      'agent.model.select': { args: (t) => ({ target: t, model: 'gpt', reasoningEffort: null, serviceTier: null }), effect: 'selectModel' },
      'agent.interrupt': { args: (t) => t, effect: 'interrupt' },
      'agent.approvalPreset.set': { args: (t) => ({ target: t, preset: 'full-access' }), effect: 'setApprovalPreset' },
      'agent.permissionMode.set': { args: (t) => ({ target: t, mode: 'acceptEdits' }), effect: 'setPermissionMode' },
      'agent.goal.set': { args: (t) => ({ target: t, objective: 'Ship' }), effect: 'changeGoal' },
      'agent.backend.set': { args: (t) => ({ target: t, backend: 'claude' }), effect: 'setBackend' },
      'agent.restart': { args: (t) => t, effect: 'restart' },
      'agent.close.preview': { args: (t) => t, effect: 'closePreview', read: true },
      'agent.close': { args: (t) => ({ target: t }), effect: 'close' },
      'agent.review.setup': { args: (t) => ({ target: t }), effect: 'reviewSetup', read: true },
      'agent.review.start': { args: (t) => ({ target: t, input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } }), effect: 'startReview' },
    };
    function ready(row: Row) {
      const f = fixture();
      const agent = { ...workspace.agents[0]!, ...row.agent };
      const current = { ...workspace, agents: [agent, workspace.agents[1]!], backends: { team: ['codex' as const, 'claude' as const] }, agentRequests: { agent: [question] } };
      f.port.workspace.mockResolvedValue(current);
      f.port.conversation.mockResolvedValue({ type: `${agent.backend}.conversationSnapshotChanged`, backend: agent.backend, agentId: 'agent', payload: { snapshot: { messages: [{ id: 'shot', parts: [{ type: 'text', text: '[Shot](/tmp/shot.png)' }] }] } } });
      return { f, current, target: { ...target, sessionId: companionSessionId(agent) } };
    }
    it('has a stale, revoked and mid-read case for each operation the gateway binds to a target', () => {
      expect(Object.keys(rows).sort()).toStrictEqual([...companionAgentMethods].sort());
    });
    it.each(Object.entries(rows))('%s rejects a replaced session and an unpaired device without acting', async (method, row) => {
      const { f, target: current } = ready(row); await f.pair();
      await expect(f.gateway.request('phone', method, row.args({ ...current, sessionId: 'replaced' }))).rejects.toThrow('stale');
      await expect(f.gateway.request('stranger', method, row.args(current))).rejects.toThrow('authorized');
      expect(f.port[row.effect]).not.toHaveBeenCalled();
    });
    it.each(Object.entries(rows))('%s never acts or answers for a device revoked during any workspace read', async (method, row) => {
      for (const revokedOnRead of [1, 2, 3]) {
        const { f, current, target: selected } = ready(row); await f.pair();
        let reads = 0; let revoked = false;
        f.port.workspace.mockImplementation(async () => {
          if (++reads === revokedOnRead) { await f.gateway.revoke('phone'); revoked = true; }
          return current;
        });
        const outcome = await f.gateway.request('phone', method, row.args(selected)).then(() => 'answered', (error: Error) => error.message);
        expect(outcome).toBe(revoked ? 'Device is not authorized.' : 'answered');
        expect(f.port[row.effect]).toHaveBeenCalledTimes(revoked && (!row.read || revokedOnRead === 1) ? 0 : 1);
      }
    });
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
  it('atomically claims a code for one peer, denies application reads until approval, and rejects reuse', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const results = await Promise.allSettled([claim(f.gateway, 'phone', invite.code), claim(f.gateway, 'other-phone', invite.code)]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    const pending = await claim(f.gateway, 'phone', invite.code);
    expect(pending.state).toBe('awaitingApproval');
    expect(f.gateway.pendingRequests).toEqual([expect.objectContaining({ id: pending.pendingId, peerId: 'phone', name: 'Phone' })]);
    await expect(f.gateway.request('phone', 'snapshot.get', {})).rejects.toThrow('authorized');
    await expect(f.gateway.request('other-phone', 'pair.status', { pendingId: pending.pendingId })).rejects.toThrow();
    await f.gateway.decide(pending.pendingId, true);
    await expect(claim(f.gateway, 'other-phone', invite.code)).rejects.toThrow('expired');
    await expect(claim(f.gateway, 'phone', invite.code)).rejects.toThrow('expired');
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: pending.pendingId })).toMatchObject({ state: 'approved' });
    const expired = f.gateway.invite(); f.advance();
    await expect(claim(f.gateway, 'phone', expired.code)).rejects.toThrow('expired');
  });
  it('keeps a claimed code bound while approval persistence fails, then consumes it on rejection', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const pending = await claim(f.gateway, 'phone', invite.code);
    f.port.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.gateway.decide(pending.pendingId, true)).rejects.toThrow('disk full');
    await expect(claim(f.gateway, 'other-phone', invite.code)).rejects.toThrow('claimed');
    expect(await claim(f.gateway, 'phone', invite.code)).toEqual(pending);
    await f.gateway.decide(pending.pendingId, false);
    await expect(claim(f.gateway, 'phone', invite.code)).rejects.toThrow('expired');
    await expect(f.gateway.request('phone', 'pair.status', { pendingId: pending.pendingId })).rejects.toThrow();
    expect(f.saved().grants).toEqual([]);
  });
  it('rejects unknown codes and bounds guesses without consuming another phone’s invitation', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const wrong = invite.code.startsWith('A') ? `B${invite.code.slice(1)}` : `A${invite.code.slice(1)}`;
    for (let attempt = 0; attempt < 10; attempt++) await expect(claim(f.gateway, 'intruder', wrong)).rejects.toThrow('expired');
    await expect(claim(f.gateway, 'intruder', invite.code)).rejects.toThrow('Too many');
    expect((await claim(f.gateway, 'phone', invite.code)).state).toBe('awaitingApproval');
  });
  it('advertises each original deadline, limits invitations, and forgets pending claims on restart', async () => {
    const f = fixture(); const invites = Array.from({ length: 5 }, () => f.gateway.invite());
    expect(f.gateway.pairingInvitations()).toEqual(invites.map(invite => ({ ...invite, code: normalizePairingCode(invite.code) })));
    expect(() => f.gateway.invite()).toThrow('Too many');
    await claim(f.gateway, 'phone', invites[0]!.code);
    const restarted = new CompanionGateway('host', f.saved(), f.port);
    await expect(claim(restarted, 'phone', invites[0]!.code)).rejects.toThrow('expired');
    f.advance(); expect(f.gateway.pairingInvitations()).toEqual([]);
    expect(f.gateway.pendingRequests).toEqual([]);
  });
  it('recovers an approved device pairing record without leaving a pending approval', async () => {
    const f = fixture(); await f.pair();
    const invite = f.gateway.invite();
    const result = await claim(f.gateway, 'phone', invite.code, 'Recovered phone');
    expect(await f.gateway.request('phone', 'pair.status', { pendingId: result.pendingId })).toMatchObject({ state: 'approved' });
    expect(f.gateway.pendingRequests).toEqual([]);
    await expect(claim(f.gateway, 'other-phone', invite.code)).rejects.toThrow('expired');
  });
  it('expires an unapproved request together with its invitation', async () => {
    const f = fixture(); const invite = f.gateway.invite();
    const { pendingId } = await claim(f.gateway, 'phone', invite.code);
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
    expect(await f.gateway.request('phone', 'models.list', target)).toStrictEqual({ models: [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }] });
    expect(f.port.models).toHaveBeenCalledExactlyOnceWith('agent');
    await f.gateway.request('phone', 'agent.model.select', { target, model: 'gpt', reasoningEffort: 'high', serviceTier: null });
    expect(f.port.selectModel).toHaveBeenCalledExactlyOnceWith('agent', { model: 'gpt', reasoningEffort: 'high', serviceTier: null });
    await expect(f.gateway.request('phone', 'models.list', { ...target, agentId: 'unknown' })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'agent.model.select', { target: { ...target, agentId: 'unknown' }, model: 'gpt', reasoningEffort: null, serviceTier: null })).rejects.toThrow('stale');
    await expect(f.gateway.request('phone', 'agent.model.select', { target, model: 'gpt', reasoningEffort: null, serviceTier: null, extra: 1 })).rejects.toThrow();
    await expect(f.gateway.request('stranger', 'models.list', target)).rejects.toThrow('authorized');
  });
  it('lets the phone stop an agent and change its permissions, only for agents the laptop shows', async () => {
    const f = fixture(); await f.pair();
    const remote = { hostId: 'host', locationId: 'ssh-host', teamId: 'remote-team', agentId: 'remote-agent', sessionId: null };
    await f.gateway.request('phone', 'agent.interrupt', target);
    await f.gateway.request('phone', 'agent.approvalPreset.set', { target, preset: 'full-access' });
    await f.gateway.request('phone', 'agent.permissionMode.set', { target: remote, mode: 'acceptEdits' });
    expect(f.port.interrupt).toHaveBeenCalledExactlyOnceWith('agent');
    expect(f.port.setApprovalPreset).toHaveBeenCalledExactlyOnceWith('agent', 'full-access');
    expect(f.port.setPermissionMode).toHaveBeenCalledExactlyOnceWith('remote-agent', 'acceptEdits');
    await expect(f.gateway.request('phone', 'agent.interrupt', { ...target, agentId: 'unknown' })).rejects.toThrow('stale');
    await expect(f.gateway.request('stranger', 'agent.interrupt', target)).rejects.toThrow('authorized');
    for (const [method, args] of [['agent.approvalPreset.set', { preset: 'x' }], ['agent.permissionMode.set', { mode: 'x' }]] as const) {
      await expect(f.gateway.request('phone', method, { target: { ...target, agentId: 'unknown' }, ...args })).rejects.toThrow('stale');
      await expect(f.gateway.request('stranger', method, { target, ...args })).rejects.toThrow('authorized');
    }
    await expect(f.gateway.request('phone', 'agent.permissionMode.set', { target, mode: 'x', extra: 1 })).rejects.toThrow();
  });
  it('never applies an agent command to a conversation that replaced the one the phone saw', async () => {
    const f = fixture(); await f.pair();
    f.port.workspace.mockResolvedValue({ ...workspace, backends: { team: ['codex', 'claude'] } });
    const old = { ...target, sessionId: JSON.stringify({ kind: 'codex', threadId: 'replaced' }) };
    const commands: [string, object][] = [
      ['agent.interrupt', old], ['models.list', old],
      ['agent.model.select', { target: old, model: 'gpt', reasoningEffort: null, serviceTier: null }],
      ['agent.approvalPreset.set', { target: old, preset: 'full-access' }], ['agent.permissionMode.set', { target: old, mode: 'acceptEdits' }],
      ['agent.backend.set', { target: old, backend: 'claude' }],
      ['agent.review.start', { target: old, input: { scope: { type: 'uncommitted' }, threadMode: 'independent' } }],
    ];
    for (const [method, args] of commands) await expect(f.gateway.request('phone', method, args)).rejects.toThrow('stale');
    for (const port of [f.port.interrupt, f.port.models, f.port.selectModel, f.port.setApprovalPreset, f.port.setPermissionMode, f.port.setBackend, f.port.startReview]) expect(port).not.toHaveBeenCalled();
  });
  it('starts a review for a shown agent with a validated scope, and passes delegation choices with a prompt', async () => {
    const f = fixture(); await f.pair();
    const input = { scope: { type: 'branch', baseRef: 'main' }, threadMode: 'independent', instructions: 'Focus on security', backend: 'claude', model: 'review-model', reasoningEffort: 'high', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: false } };
    await f.gateway.request('phone', 'agent.review.start', { target, input });
    expect(f.port.startReview).toHaveBeenCalledExactlyOnceWith('agent', input);
    await expect(f.gateway.request('phone', 'agent.review.start', { target: { ...target, agentId: 'unknown' }, input })).rejects.toThrow('stale');
    await expect(f.gateway.request('stranger', 'agent.review.start', { target, input })).rejects.toThrow('authorized');
    for (const bad of [{ ...input, scope: { type: 'branch' } }, { ...input, threadMode: 'both' }, { ...input, backend: 'invalid' }, { ...input, threadMode: 'current' }, { ...input, automation: { ...input.automation, maxRounds: 11 } }]) {
      await expect(f.gateway.request('phone', 'agent.review.start', { target, input: bad })).rejects.toThrow();
    }
    const delegation = { startingContext: 'handoff', instructions: 'Run the focused tests' };
    await f.gateway.request('phone', 'prompt.submit', { target, text: '/delegate', clientCommandId: randomUUID(), options: { delegation } });
    expect(f.port.submit).toHaveBeenLastCalledWith(target, '/delegate', 'mobile:phone', { delegation });
    await expect(f.gateway.request('phone', 'prompt.submit', { target, text: '/delegate', clientCommandId: randomUUID(), options: { delegation: { startingContext: 'copy' } } })).rejects.toThrow();
  });
  it('forwards composer options with a prompt and treats different options as a different command', async () => {
    const f = fixture(); await f.pair();
    const command = { target, text: 'Plan it', clientCommandId: randomUUID(), options: { model: 'gpt', reasoningEffort: 'high', serviceTier: null, planMode: true } };
    await f.gateway.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith(target, 'Plan it', 'mobile:phone', command.options);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, options: { ...command.options, planMode: false } })).rejects.toThrow('reused');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), options: { cwd: '/etc' } })).rejects.toThrow();
  });
  it('hands phone attachments to the laptop with the prompt and rejects oversized or malformed ones', async () => {
    const f = fixture(); await f.pair();
    const photo = { type: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpeg').toString('base64') };
    const command = { target, text: '', clientCommandId: randomUUID(), attachments: [photo] };
    expect(await f.gateway.request('phone', 'prompt.submit', command)).toMatchObject({ state: 'accepted' });
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith(target, '', 'mobile:phone', undefined, [{ ...photo, data: Buffer.from('jpeg') }]);
    // The ledger keeps a fingerprint, never the bytes.
    expect(JSON.stringify(f.saved())).not.toContain(photo.data);
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), text: '', attachments: [] })).rejects.toThrow('text or an attachment');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [{ ...photo, data: 'not base64!' }] })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [{ ...photo, data: Buffer.alloc(2_600_000).toString('base64') }] })).rejects.toThrow();
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: Array(6).fill(photo) })).rejects.toThrow();
    const large = { ...photo, data: Buffer.alloc(1_300_000).toString('base64') };
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [large, large] })).rejects.toThrow('Attachment too large');
    await expect(f.gateway.request('phone', 'prompt.submit', { ...command, clientCommandId: randomUUID(), attachments: [{ ...photo, data: 'AA=' }] })).rejects.toThrow();
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
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith(target, 'Reply once', 'mobile:phone', undefined);
    const restored = new CompanionGateway('host', f.saved(), f.port);
    expect(await restored.request('phone', 'command.status', { clientCommandId: command.clientCommandId })).toMatchObject({ state: 'accepted' });
    await restored.request('phone', 'prompt.submit', command);
    expect(f.port.submit).toHaveBeenCalledTimes(1);
    await expect(restored.request('phone', 'prompt.submit', { ...command, text: 'Changed' })).rejects.toThrow('reused');
  });
  it('reports a prompt left pending by an ended process as unresolved and never replays it', async () => {
    const f = fixture(); await f.pair(); f.port.submit.mockReturnValueOnce(new Promise(() => {}));
    const command = { target, text: 'Maybe sent', clientCommandId: randomUUID() };
    void f.gateway.request('phone', 'prompt.submit', command);
    await vi.waitFor(() => expect(f.port.submit).toHaveBeenCalledTimes(1));
    const restarted = new CompanionGateway('host', f.saved(), f.port);
    expect(await restarted.request('phone', 'command.status', { clientCommandId: command.clientCommandId })).toStrictEqual({ target, clientCommandId: command.clientCommandId, state: 'unresolved' });
    expect(await restarted.request('phone', 'prompt.submit', command)).toStrictEqual({ target, clientCommandId: command.clientCommandId, state: 'unresolved' });
    expect(f.port.submit).toHaveBeenCalledTimes(1);
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
  it('expires old command receipts so mobile sending never fills up, and forgets them when a device is revoked', async () => {
    const f = fixture(); await f.pair();
    const stale = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`phone:${randomUUID()}`, { clientCommandId: randomUUID(), state: 'accepted' as const, target, fingerprint: 'x', createdAt: index }]));
    const full = new CompanionGateway('host', { ...f.saved(), commands: stale }, f.port, () => 8 * 86_400_000);
    const fresh = { target, text: 'Still works', clientCommandId: randomUUID() };
    expect(await full.request('phone', 'prompt.submit', fresh)).toMatchObject({ state: 'accepted' });
    expect(Object.keys(f.saved().commands)).toEqual([`phone:${fresh.clientCommandId}`]);
    expect(await full.request('phone', 'command.status', { clientCommandId: fresh.clientCommandId })).not.toHaveProperty('createdAt');
    await full.revoke('phone');
    expect(f.saved().commands).toEqual({});
  });
  it('keeps receipts from before timestamps existed until they age out', async () => {
    const f = fixture(); await f.pair();
    const legacy = { clientCommandId: randomUUID(), state: 'accepted' as const, target, fingerprint: 'x' };
    const gateway = new CompanionGateway('host', { ...f.saved(), commands: { [`phone:${legacy.clientCommandId}`]: legacy } }, f.port, () => 5);
    await gateway.request('phone', 'prompt.submit', { target, text: 'Next', clientCommandId: randomUUID() });
    expect(f.saved().commands[`phone:${legacy.clientCommandId}`]).toMatchObject({ createdAt: 5 });
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
    expect(f.port.submit).toHaveBeenCalledExactlyOnceWith(remote, 'Remote prompt', 'mobile:phone', undefined);
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
      await f.gateway.request('phone', 'agent.backend.set', { target, backend: 'claude' });
      expect(f.port.setBackend).toHaveBeenCalledExactlyOnceWith('agent', 'claude');
    });
    it.each([
      ['a chat that already has a conversation', { backendSession: { kind: 'codex', threadId: 'thread' } }, 'claude'],
      ['a chat that has sent a prompt', { hasSubmittedPrompt: true }, 'claude'],
      ['a chat that is working', { status: { type: 'working' } }, 'claude'],
      ['an engine the laptop cannot use', {}, 'antigravity'],
    ])('refuses %s', async (_name, change, backend) => {
      const f = await ready(change);
      const current = 'backendSession' in change ? { ...target, sessionId: JSON.stringify(change.backendSession) } : target;
      await expect(f.gateway.request('phone', 'agent.backend.set', { target: current, backend })).rejects.toThrow();
      await expect(f.gateway.request('phone', 'agent.backend.set', { target: { ...target, agentId: 'ghost' }, backend: 'claude' })).rejects.toThrow('stale');
      expect(f.port.setBackend).not.toHaveBeenCalled();
    });
    it('needs a paired phone', async () => {
      const f = fixture();
      await expect(f.gateway.request('stranger', 'agent.backend.set', { target, backend: 'claude' })).rejects.toThrow('authorized');
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
