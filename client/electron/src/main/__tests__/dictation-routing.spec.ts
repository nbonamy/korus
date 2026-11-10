import { describe, expect, it, vi } from 'vitest';
import { createDictationSpeechPreparer, createDictationSpeechStarter } from '../dictation-routing';

vi.mock('ai-app-sdk/electron', () => ({ startAppleSpeechSession: vi.fn(), startOpenAISpeechSession: vi.fn(), prepareOpenAISpeechSession: vi.fn() }));
describe('dictation engine routing', () => {
  it('reads preferences per recording and supplies credentials only to OpenAI, retaining SDK session ownership', async () => {
    let engine = 'apple';
    const session = { append: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
    const apple = vi.fn().mockResolvedValue(session);
    const openai = vi.fn().mockResolvedValue(session);
    const apiKey = vi.fn(() => 'test-secret');
    const start = createDictationSpeechStarter({ get: () => ({ engine }), apiKey }, { apple, openai });
    const input = { sessionId: 'recording', sampleRate: 24000 };
    const onEvent = vi.fn();
    const options = { signal: new AbortController().signal, assetsPath: '/sdk/assets' };
    expect(await start(input, onEvent, options)).toBe(session);
    expect(apple).toHaveBeenCalledWith(input, onEvent, options);
    expect(apiKey).not.toHaveBeenCalled();
    engine = 'openai';
    expect(await start(input, onEvent, options)).toBe(session);
    expect(openai).toHaveBeenCalledWith(input, onEvent, { signal: options.signal, apiKey: 'test-secret', model: 'gpt-transcribe' });
    expect(apple).toHaveBeenCalledTimes(1);
  });
  it('pins the engine during preparation and starts Apple only with the actual microphone rate', async () => {
    let engine = 'apple';
    const session = { append: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
    const apple = vi.fn().mockResolvedValue(session);
    const openai = vi.fn();
    const apiKey = vi.fn(() => 'test-secret');
    const prepare = createDictationSpeechPreparer({ get: () => ({ engine }), apiKey }, { apple, openai });
    const input = { sessionId: 'recording', locale: 'fr-FR' };
    const onEvent = vi.fn();
    const options = { signal: new AbortController().signal, assetsPath: '/sdk/assets' };
    const prepared = await prepare(input, onEvent, options);
    expect(apple).not.toHaveBeenCalled();
    expect(apiKey).not.toHaveBeenCalled();
    engine = 'openai';
    expect(await prepared.start(48000)).toBe(session);
    expect(apple).toHaveBeenCalledExactlyOnceWith({ ...input, sampleRate: 48000 }, onEvent, options);
    expect(openai).not.toHaveBeenCalled();
  });
  it.each([[false, 'gpt-transcribe'], [true, 'gpt-live-transcribe']] as const)('prepares the selected OpenAI model (live=%s) with host-only credentials', async (openaiLiveTranscription, model) => {
    const prepared = { start: vi.fn(), cancel: vi.fn() };
    const apple = vi.fn(), openai = vi.fn().mockResolvedValue(prepared);
    const prepare = createDictationSpeechPreparer({ get: () => ({ engine: 'openai', openaiLiveTranscription }), apiKey: () => 'test-secret' }, { apple, openai });
    const input = { sessionId: 'recording', locale: 'en-US' };
    const onEvent = vi.fn();
    const signal = new AbortController().signal;
    expect(await prepare(input, onEvent, { signal, assetsPath: '/sdk/assets' })).toBe(prepared);
    expect(openai).toHaveBeenCalledExactlyOnceWith(input, onEvent, { signal, apiKey: 'test-secret', model });
    expect(apple).not.toHaveBeenCalled();
    const missingKey = createDictationSpeechPreparer({ get: () => ({ engine: 'openai' }), apiKey: () => undefined }, { apple, openai });
    await expect(missingKey(input, onEvent, { signal })).rejects.toThrow('Dictation settings');
    expect(openai).toHaveBeenCalledTimes(1);
  });
  it('requires a saved key without falling back to another engine', async () => {
    const apple = vi.fn(), openai = vi.fn();
    const start = createDictationSpeechStarter({ get: () => ({ engine: 'openai' }), apiKey: () => undefined }, { apple, openai });
    await expect(start({ sessionId: 'recording', sampleRate: 24000 }, vi.fn())).rejects.toThrow('Dictation settings');
    expect(apple).not.toHaveBeenCalled();
    expect(openai).not.toHaveBeenCalled();
  });
});
