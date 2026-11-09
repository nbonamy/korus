/** Desktop-local preferences; credentials never enter shared app snapshots. */
export type DictationEngine = 'apple' | 'openai';
export interface DictationSettings {
  engine: DictationEngine;
  openaiLiveTranscription: boolean;
  appleAvailable: boolean;
  hasApiKey: boolean;
  secureStorageAvailable: boolean;
}
export interface DictationSettingsInput {
  engine?: DictationEngine;
  openaiLiveTranscription?: boolean;
  /** null removes the saved credential. Omit to preserve it. */
  apiKey?: string | null;
}
