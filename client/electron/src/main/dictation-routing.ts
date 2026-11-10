import { prepareOpenAISpeechSession, startAppleSpeechSession, startOpenAISpeechSession, type NativeMainOptions as CodexNativeMainOptions } from 'ai-app-sdk/electron';

type Preferences = { get(): { engine: string; openaiLiveTranscription?: boolean }; apiKey(): string | undefined };
/** Select once at start; the SDK retains the returned session for append/stop/cancel. */
export function createDictationSpeechStarter(
  settings: Preferences,
  engines = { apple: startAppleSpeechSession, openai: startOpenAISpeechSession },
): typeof startAppleSpeechSession {
  return async (input, onEvent, options) => {
    const current = settings.get();
    if (current.engine === 'apple') return engines.apple(input, onEvent, options);
    const apiKey = settings.apiKey();
    if (!apiKey) throw new Error('Add an OpenAI API key in Dictation settings before recording.');
    return engines.openai(input, onEvent, { apiKey, signal: options?.signal, model: current.openaiLiveTranscription ? 'gpt-live-transcribe' : 'gpt-transcribe' });
  };
}

/** Connect OpenAI while the renderer opens the microphone; select the engine once. */
export function createDictationSpeechPreparer(
  settings: Preferences,
  engines = { apple: startAppleSpeechSession, openai: prepareOpenAISpeechSession },
): NonNullable<CodexNativeMainOptions['prepareSpeechSession']> {
  return async (input, onEvent, options) => {
    const current = settings.get();
    if (current.engine === 'apple') {
      return {
        start: sampleRate => engines.apple({ ...input, sampleRate }, onEvent, options),
        cancel: async () => {},
      };
    }
    const apiKey = settings.apiKey();
    if (!apiKey) throw new Error('Add an OpenAI API key in Dictation settings before recording.');
    return engines.openai(input, onEvent, { apiKey, signal: options?.signal, model: current.openaiLiveTranscription ? 'gpt-live-transcribe' : 'gpt-transcribe' });
  };
}
