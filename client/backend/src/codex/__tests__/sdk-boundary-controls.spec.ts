import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexSdkFixture, sdkAgent, sdkSnapshot } from './sdk-surface-fixture';

describe(`Codex SDK → ${product.name} backend controls`, () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  it('refreshes the SDK model catalog without filtering new models or exposing mutable SDK arrays', async () => {
    const { driver, surface } = setup();
    const models = [{ id: 'new-model', model: 'new-model', displayName: 'New', description: '', defaultReasoningEffort: 'high', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Deep' }], serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }], defaultServiceTier: 'fast' }];
    surface.listModels.mockResolvedValue(models);
    const result = await driver.listModels(sdkAgent());
    expect(result).toStrictEqual(models);
    expect(result[0]).not.toBe(models[0]);
    expect(result[0]!.supportedReasoningEfforts).not.toBe(models[0]!.supportedReasoningEfforts);
    expect(surface.listModels).toHaveBeenCalledWith({ includeHidden: false, forceReload: true });
    surface.listModels.mockRejectedValueOnce(new Error('catalog offline'));
    await expect(driver.listModels(sdkAgent())).rejects.toThrow('catalog offline');
  });

  it('uses conversation-specific permissions without leaking them between agents', async () => {
    const { driver, conversation } = setup();
    conversation('conversation-a').setSnapshot({ approvalPresets: ['ask-for-approval'] });
    conversation('conversation-b').setSnapshot({ approvalPresets: ['full-access'] });
    await driver.loadConversation(sdkAgent());
    await driver.loadConversation(sdkAgent('agent-b', 'conversation-b'));
    conversation('conversation-b').handle.updateSettings.mockClear();
    expect(driver.getCapabilities(sdkAgent()).approvalPresets).toStrictEqual(['ask-for-approval']);
    expect(driver.getCapabilities(sdkAgent('agent-b', 'conversation-b')).approvalPresets).toStrictEqual(['full-access']);
    await expect(driver.setApprovalPreset(sdkAgent(), 'full-access')).resolves.toMatchObject({ approvalPreset: 'ask-for-approval' });
    expect(conversation('conversation-a').handle.updateSettings).toHaveBeenCalledWith({ approvalPreset: 'ask-for-approval' });
    expect(conversation('conversation-b').handle.updateSettings).not.toHaveBeenCalled();
  });

  it('generates ephemeral drafts with defaults without creating an agent conversation', async () => {
    const { driver, surface } = setup();
    surface.generateText.mockResolvedValue({ text: 'feat: ship' });
    const agent = { ...sdkAgent(), backendDefaults: { kind: 'codex' as const, model: 'model', reasoningEffort: 'high', serviceTier: 'fast' } };
    await expect(driver.generateText(agent, { prompt: 'draft', cwd: '/repo', developerInstructions: 'Keep short', outputSchema: { type: 'object' } })).resolves.toStrictEqual({ text: 'feat: ship' });
    expect(surface.generateText).toHaveBeenCalledWith('draft', { cwd: '/repo', developerInstructions: 'Keep short', model: 'model', reasoningEffort: 'high', serviceTier: 'fast', outputSchema: { type: 'object' } });
    expect(surface.createConversation).not.toHaveBeenCalled();
    expect(surface.conversation).not.toHaveBeenCalled();
  });

  it('delegates account lifecycle and device-login identity without handling credentials', async () => {
    const { driver, surface } = setup();
    surface.refreshAccount.mockResolvedValue(sdkSnapshot());
    surface.cancelLogin.mockResolvedValue(sdkSnapshot());
    surface.logout.mockResolvedValue(sdkSnapshot());
    surface.startChatGptLogin.mockResolvedValue({ loginId: 'browser', authUrl: 'https://example.test/auth' });
    surface.startChatGptDeviceCodeLogin.mockResolvedValue({ loginId: 'device', verificationUrl: 'https://example.test/device', userCode: 'ABCD' });
    await expect(driver.getAuthentication()).resolves.toStrictEqual({ account: null, requiresOpenaiAuth: false, login: { status: 'idle', error: null } });
    await expect(driver.startChatGptLogin()).resolves.toStrictEqual({ loginId: 'browser', authUrl: 'https://example.test/auth' });
    await expect(driver.startChatGptDeviceCodeLogin()).resolves.toStrictEqual({ loginId: 'device', verificationUrl: 'https://example.test/device', userCode: 'ABCD' });
    await driver.cancelChatGptLogin('device');
    expect(surface.cancelLogin).toHaveBeenCalledWith('device');
    await driver.logout();
    expect(surface.logout).toHaveBeenCalledOnce();
    surface.startChatGptDeviceCodeLogin.mockRejectedValueOnce(new Error('login unavailable'));
    await expect(driver.startChatGptDeviceCodeLogin()).rejects.toThrow('login unavailable');
  });

  it('maps remote pairing timestamps and enforces provider remote-control requirements in its result', async () => {
    const { driver, surface } = setup();
    const status = { status: 'connected' as const, serverName: product.name, installationId: 'install', environmentId: 'environment' };
    surface.readRemoteControlStatus.mockResolvedValue(status);
    surface.readConfigRequirements.mockResolvedValue({ allowRemoteControl: false } as NonNullable<Awaited<ReturnType<typeof surface.readConfigRequirements>>>);
    await expect(driver.getRemoteControlStatus()).resolves.toStrictEqual({ ...status, allowRemoteControl: false });
    surface.startRemoteControlPairing.mockResolvedValue({ pairingCode: 'opaque', manualPairingCode: 'CODE', environmentId: 'environment', expiresAt: 1_900_000_000n });
    const pairing = await driver.startDevicePairing();
    expect(pairing).toStrictEqual({ pairingCode: 'opaque', manualPairingCode: 'CODE', environmentId: 'environment', expiresAt: '2030-03-17T17:46:40.000Z' });
    expect(surface.startRemoteControlPairing).toHaveBeenCalledWith({ manualCode: true });
    surface.readRemoteControlPairingStatus.mockResolvedValue({ claimed: true });
    await expect(driver.checkDevicePairing(pairing)).resolves.toBe(true);
    expect(surface.readRemoteControlPairingStatus).toHaveBeenCalledWith({ pairingCode: 'opaque' });
    await driver.revokePairedDevice('environment', 'client');
    expect(surface.revokeRemoteControlClient).toHaveBeenCalledWith({ environmentId: 'environment', clientId: 'client' });
    surface.enableRemoteControl.mockResolvedValue(status);
    surface.disableRemoteControl.mockResolvedValue({ ...status, status: 'disabled' });
    await expect(driver.enableRemoteControl()).resolves.toMatchObject({ status: 'connected', allowRemoteControl: false });
    await expect(driver.disableRemoteControl()).resolves.toMatchObject({ status: 'disabled' });
    await driver.checkDevicePairing({ ...pairing, pairingCode: '' });
    expect(surface.readRemoteControlPairingStatus).toHaveBeenLastCalledWith({ manualPairingCode: 'CODE' });
    surface.listRemoteControlClients.mockResolvedValue({ data: [{ clientId: 'client', displayName: 'Phone', deviceType: 'phone', platform: 'iOS', osVersion: '26', deviceModel: 'iPhone', appVersion: '1', lastSeenAt: 1_800_000_000n }], nextCursor: null });
    await expect(driver.listPairedDevices('environment')).resolves.toMatchObject([{ clientId: 'client', lastSeenAt: '2027-01-15T08:00:00.000Z' }]);
  });

  it('preserves attachments and turn identity through steer, edit, retry, delete and fork', async () => {
    const { driver, conversation, surface } = setup();
    const handle = conversation('conversation-a').handle;
    const attachments = [{ type: 'image' as const, path: '/image.png', detail: 'high' as const }, { type: 'file' as const, path: '/file.md', name: 'file' }];
    const content = [{ type: 'text' as const, text: '$cp vs ' },
      { type: 'mention' as const, kind: 'skill' as const, id: '/skills/cp/SKILL.md', value: 'cp', label: 'Commit and push' },
      { type: 'text' as const, text: ' in ' }, { type: 'mention' as const, kind: 'file' as const, id: '/src/target.ts', value: '/src/target.ts', label: 'target.ts' }];
    const visible = '$cp vs Commit and push in target.ts\n\n<context>Host context</context>';
    const dispatched = '$cp vs [$cp](/skills/cp/SKILL.md) in @/src/target.ts\n\n<context>Host context</context>';
    await driver.sendPrompt(sdkAgent(), visible, driver.preparePromptOptions(sdkAgent(), { attachments, content }));
    expect(handle.sendMessage).toHaveBeenCalledWith(dispatched, { attachments, content });
    await driver.steerPrompt(sdkAgent(), dispatched, driver.preparePromptOptions(sdkAgent(), { content }));
    expect(handle.steerMessage).toHaveBeenCalledWith(dispatched, { content });
    await driver.editTurn(sdkAgent(), 'turn', visible, { content });
    expect(handle.editTurn).toHaveBeenCalledWith('turn', dispatched, { content });
    await driver.retryTurn(sdkAgent(), 'turn');
    expect(handle.retryTurn).toHaveBeenCalledWith('turn');
    await driver.continueInterruptedTurn(sdkAgent());
    expect(handle.continueInterruptedTurn).toHaveBeenCalledOnce();
    expect(handle.sendMessage).toHaveBeenCalledOnce();
    await driver.deleteTurn(sdkAgent(), 'turn');
    expect(handle.deleteTurn).toHaveBeenCalledWith('turn');
    handle.forkTurn.mockResolvedValue({ conversationId: 'fork', conversation: surface.conversation('fork'), snapshot: sdkSnapshot('fork') });
    const target = sdkAgent('fork-agent', 'fork');
    await expect(driver.forkConversation(sdkAgent(), target, 'turn')).resolves.toMatchObject({ backendSession: { kind: 'codex', threadId: 'fork' } });
    expect(handle.forkTurn).toHaveBeenCalledWith('turn', { cwd: '/repo' }, { extensionContext: target });
    expect(conversation('fork').listenerCount()).toBe(1);
    handle.fork.mockResolvedValue({ conversationId: 'whole-fork', conversation: surface.conversation('whole-fork'), snapshot: sdkSnapshot('whole-fork') });
    await driver.forkConversation(sdkAgent(), { ...target, id: 'whole-fork-agent' });
    expect(handle.fork).toHaveBeenCalledWith({ cwd: '/repo' }, { extensionContext: expect.objectContaining({ id: 'whole-fork-agent' }) });
  });

  // A concurrent owner steer or async answer must not erase a guest receipt or
  // attribute the owner's message to the guest, even when their text is identical.
  it.each(['steer', 'async answer'] as const)('preserves a guest steering receipt during an overlapping owner %s', async operation => {
    const { driver, conversation } = setup();
    const agent = sdkAgent(); const session = conversation('conversation-a');
    const request = { id: 'question', conversationId: 'conversation-a', turnId: 'turn', itemId: 'question', kind: 'ask_user' as const,
      payload: { request: { itemId: 'question', delivery: 'async' as const, blocking: false, questions: [] } } };
    const initial = { activeTurnId: 'turn', turnIds: ['turn'], busy: true, clientRequests: [request] };
    const guest = { id: 'guest', role: 'user' as const, kind: 'steer' as const, status: 'complete' as const, turnId: 'turn', parts: [{ type: 'text' as const, text: 'Same text' }] };
    const owner = { ...guest, id: 'owner' };
    session.setSnapshot(initial);
    let release!: () => void;
    const acceptance = new Promise<void>(resolve => { release = resolve; });
    session.handle.steerMessage.mockImplementationOnce(async () => {
      session.setSnapshot({ ...initial, messages: [guest] });
      await acceptance;
      return session.handle.getSnapshot();
    });
    const ownerSnapshot = async () => {
      session.setSnapshot({ ...initial, messages: [guest, owner] });
      return session.handle.getSnapshot();
    };
    session.handle.steerMessage.mockImplementationOnce(ownerSnapshot);
    session.handle.respondToClientRequest.mockImplementationOnce(ownerSnapshot);
    const guestSending = driver.steerPrompt(agent, 'Same text');
    try {
      await vi.waitFor(() => expect(session.handle.steerMessage).toHaveBeenCalledTimes(1));
      const ownerSending = operation === 'steer' ? driver.steerPrompt(agent, 'Same text')
        : driver.respondToAgentRequest({ agentId: agent.id, id: request.id, outcome: { kind: 'answered', answers: {} } });
      // Let the second request reach the already-loaded adapter before acceptance.
      await new Promise<void>(resolve => setImmediate(resolve));
      release();
      const [receipt, ownerReceipt] = await Promise.all([guestSending, ownerSending]);
      expect(receipt).toStrictEqual({ backendSession: { kind: 'codex', threadId: 'conversation-a' }, turnId: 'turn', messageId: guest.id });
      if (operation === 'steer') expect(ownerReceipt).toStrictEqual({ backendSession: { kind: 'codex', threadId: 'conversation-a' }, turnId: 'turn', messageId: owner.id });
      else expect(session.handle.respondToClientRequest).toHaveBeenCalledExactlyOnceWith({ id: request.id, payload: { answers: {} } });
    } finally { release(); await guestSending; }
  });

  it('forks a worktree assignment at the last completed native turn with the worker configuration', async () => {
    const { driver, conversation, surface } = setup();
    const source = sdkAgent();
    const original = structuredClone(source);
    conversation('conversation-a').setSnapshot({ activeTurnId: 'delegating', busy: true,
      turnIds: ['discussion', 'delegating'],
      turns: [{ id: 'discussion', status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null }, { id: 'delegating', status: 'inProgress', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null }],
    });
    const target = { ...sdkAgent('worker', 'unused'), folder: '/repo-worktree', backendSession: undefined,
      backendDefaults: { kind: 'codex' as const, model: 'worker-model', reasoningEffort: 'high', serviceTier: null } };
    const handle = conversation('conversation-a').handle;
    handle.forkTurn.mockResolvedValue({ conversationId: 'worker-thread', conversation: surface.conversation('worker-thread'), snapshot: sdkSnapshot('worker-thread') });
    await expect(driver.forkWorktreeConversation(source, target)).resolves.toMatchObject({ backendSession: { kind: 'codex', threadId: 'worker-thread' } });
    expect(handle.forkTurn).toHaveBeenCalledWith('discussion', expect.objectContaining({ cwd: '/repo-worktree', model: 'worker-model', reasoningEffort: 'high', serviceTier: null }), { extensionContext: target });
    expect(handle.fork).not.toHaveBeenCalled();
    expect(source).toStrictEqual(original);
    await driver.sendPrompt({ ...target, backendSession: { kind: 'codex', threadId: 'worker-thread' } }, 'Implement the agreed task');
    expect(conversation('worker-thread').handle.sendMessage).toHaveBeenCalled();
    expect(handle.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a busy delegation without a completed boundary without creating a child', async () => {
    const { driver, conversation } = setup();
    conversation('conversation-a').setSnapshot({ activeTurnId: 'first-turn', busy: true });
    await expect(driver.forkWorktreeConversation(sdkAgent(), { ...sdkAgent('worker'), folder: '/worker' })).rejects.toThrow('No completed');
    expect(conversation('conversation-a').handle.fork).not.toHaveBeenCalled();
    expect(conversation('conversation-a').handle.forkTurn).not.toHaveBeenCalled();
  });

  it('forks an idle worker with its permission policy and directory', async () => {
    const { driver, conversation, surface } = setup();
    surface.getSnapshot.mockReturnValue(sdkSnapshot('conversation-a', { approvalPresets: ['ask-for-approval', 'full-access'] }));
    const target = { ...sdkAgent('worker'), folder: '/worker', backendSession: undefined,
      backendDefaults: { kind: 'codex' as const, approvalPreset: 'ask-for-approval' as const } };
    conversation('conversation-a').handle.fork.mockResolvedValue({ conversationId: 'child', conversation: surface.conversation('child'), snapshot: sdkSnapshot('child') });
    await driver.forkWorktreeConversation(sdkAgent(), target);
    expect(conversation('conversation-a').handle.fork).toHaveBeenCalledExactlyOnceWith({ cwd: '/worker', approvalPreset: 'ask-for-approval' }, { extensionContext: target });
  });

  it('leaves compact to the app and delegates review slash handling to the SDK', async () => {
    const { driver, conversation } = setup();
    expect(driver.tryHandlePromptCommand(sdkAgent(), '/compact')).toBeNull();
    expect(driver.tryHandlePromptCommand(sdkAgent(), '/compact extra')).toBeNull();
    conversation('conversation-a').handle.sendMessage.mockResolvedValue(sdkSnapshot('conversation-a', { turnIds: ['review'] }));
    await expect(driver.tryHandlePromptCommand(sdkAgent(), '/review check regressions')).resolves.toMatchObject({ turnId: 'review' });
    expect(conversation('conversation-a').handle.sendMessage).toHaveBeenCalledWith('/review check regressions', {});
  });

  it('propagates explicit rename failure without hiding it behind best-effort initial naming', async () => {
    const { driver, conversation } = setup();
    await driver.loadConversation(sdkAgent());
    conversation('conversation-a').handle.rename.mockRejectedValueOnce(new Error('rename failed'));
    await expect(driver.setConversationTitle(sdkAgent(), 'New title')).rejects.toThrow('rename failed');
    await driver.setConversationTitle(sdkAgent(), 'New title');
    expect(conversation('conversation-a').handle.rename).toHaveBeenLastCalledWith('New title');
  });
});
