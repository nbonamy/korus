import { afterEach, describe, expect, it } from 'vitest';
import { codexSdkFixture, sdkAgent, sdkSnapshot } from './sdk-surface-fixture';

describe('Codex SDK image bridge', () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  function setup() {
    const fixture = codexSdkFixture();
    fixtures.push(fixture);
    fixture.surface.listModels.mockResolvedValue([
      { id: 'sol', model: 'gpt-6.1-sol', displayName: 'Sol', description: '', supportedReasoningEfforts: [], defaultReasoningEffort: 'low', isDefault: true },
      { id: 'luna', model: 'gpt-6-luna', displayName: 'Luna', description: '', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }], defaultReasoningEffort: 'low', isDefault: false },
    ]);
    fixture.surface.createConversation.mockResolvedValue(sdkSnapshot('image-job'));
    const job = fixture.conversation('image-job');
    job.setSnapshot({ turnIds: ['image-turn'], messages: [{ id: 'image-message', role: 'assistant', status: 'complete', turnId: 'image-turn', parts: [
      { type: 'tool', id: 'image', title: 'image_generation', status: 'completed' },
      { type: 'media', itemId: 'image', media: { url: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png' } },
      { type: 'media', itemId: 'unrelated', media: { url: 'data:image/png;base64,b3RoZXI=', mimeType: 'image/png' } },
    ] }] });
    job.handle.sendMessage.mockImplementation(async () => {
      job.emit({ type: 'turn.completed', origin: 'notification', seq: 1, occurredAt: '', conversationId: 'image-job', turnId: 'image-turn',
        payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
      return job.handle.getSnapshot();
    });
    return { ...fixture, job };
  }

  it('runs Luna through existing conversation operations, returns only generated media and deletes the internal chat', async () => {
    const { driver, surface, job } = setup();
    const caller = sdkAgent();
    const before = structuredClone(caller);
    await expect(driver.generateImage(caller, { prompt: 'A transparent blue flower', cwd: '/repo' })).resolves.toStrictEqual({
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
    });
    expect(surface.createConversation).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-6-luna', cwd: '/repo', permissionMode: 'read-only' }), { mcpServers: [] });
    expect(job.handle.sendMessage).toHaveBeenCalledWith('A transparent blue flower');
    expect(surface.deleteConversation).toHaveBeenCalledWith('image-job');
    expect(surface.forgetConversation).toHaveBeenCalledWith('image-job');
    expect(job.listenerCount()).toBe(0);
    expect(caller).toStrictEqual(before);
  });

  it('cleans up an unsuccessful image job and never falls back to another model', async () => {
    const { driver, surface, job } = setup();
    job.setSnapshot({ messages: [] });
    await expect(driver.generateImage(sdkAgent(), { prompt: 'A flower', cwd: '/repo' })).rejects.toThrow(/image/i);
    expect(surface.deleteConversation).toHaveBeenCalledWith('image-job');
    surface.createConversation.mockClear();
    surface.listModels.mockResolvedValue([]);
    await expect(driver.generateImage(sdkAgent(), { prompt: 'A flower', cwd: '/repo' })).rejects.toThrow(/Luna/);
    expect(surface.createConversation).not.toHaveBeenCalled();
  });

  it('interrupts and deletes a cancelled internal chat', async () => {
    const { driver, surface, job } = setup();
    const controller = new AbortController();
    job.handle.sendMessage.mockImplementation(async () => {
      controller.abort();
      return job.handle.getSnapshot();
    });
    await expect(driver.generateImage(sdkAgent(), { prompt: 'A flower', cwd: '/repo' }, controller.signal)).rejects.toThrow(/abort|cancel/i);
    expect(job.handle.interrupt).toHaveBeenCalled();
    expect(surface.deleteConversation).toHaveBeenCalledWith('image-job');
    expect(job.listenerCount()).toBe(0);
  });

  it('rejects an interactive approval even when completion arrives before the send acknowledgment', async () => {
    const { driver, job, surface } = setup();
    job.handle.sendMessage.mockImplementation(async () => {
      job.emit({ type: 'approval.requested', origin: 'notification', seq: 1, occurredAt: '', conversationId: 'image-job',
        payload: { approval: { id: 'approval', itemId: 'command', kind: 'command', conversationId: 'image-job', title: 'Run command', allowedScopes: ['once'] } } });
      job.emit({ type: 'turn.completed', origin: 'notification', seq: 2, occurredAt: '', conversationId: 'image-job', turnId: 'image-turn',
        payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } });
      return job.handle.getSnapshot();
    });
    await expect(driver.generateImage(sdkAgent(), { prompt: 'Flower', cwd: '/repo' })).rejects.toThrow(/interactive/);
    expect(surface.deleteConversation).toHaveBeenCalledWith('image-job');
  });
});
