import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DictationSettings, DictationSettingsInput } from '@workspace/core/dictation';

type SecureStorage = {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export class DictationSettingsStore {
  constructor(private readonly directory: string, private readonly storage: SecureStorage, private readonly platform: string) {}
  private file(name: string): string { return path.join(this.directory, name); }
  private secure(): boolean {
    return this.storage.isEncryptionAvailable() && !(this.platform === 'linux' && this.storage.getSelectedStorageBackend?.() === 'basic_text');
  }
  get(): DictationSettings {
    let engine: DictationSettings['engine'] = this.platform === 'darwin' ? 'apple' : 'openai';
    let openaiLiveTranscription = false;
    let text: string | undefined;
    try { text = readFileSync(this.file('dictation.json'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to read dictation settings.');
    }
    if (text !== undefined) {
      // A corrupt document falls back to defaults so the next save can repair it.
      let saved: { engine?: unknown; openaiLiveTranscription?: unknown } | undefined;
      try { saved = JSON.parse(text); } catch { saved = undefined; }
      if (saved && typeof saved === 'object') {
        if (saved.engine === 'openai' || (saved.engine === 'apple' && this.platform === 'darwin')) engine = saved.engine;
        openaiLiveTranscription = saved.openaiLiveTranscription === true;
      }
    }
    return { engine, openaiLiveTranscription, appleAvailable: this.platform === 'darwin', hasApiKey: existsSync(this.file('dictation-openai-key.bin')), secureStorageAvailable: this.secure() };
  }
  update(input: DictationSettingsInput): DictationSettings {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => key !== 'engine' && key !== 'apiKey' && key !== 'openaiLiveTranscription')
      || (input.openaiLiveTranscription !== undefined && typeof input.openaiLiveTranscription !== 'boolean')
      || (input.engine !== undefined && input.engine !== 'apple' && input.engine !== 'openai')
      || (input.apiKey !== undefined && input.apiKey !== null && (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096))) throw new Error('Invalid dictation settings.');
    if (input.engine === 'apple' && this.platform !== 'darwin') throw new Error('Apple Speech Analyzer is unavailable on this platform.');
    if (typeof input.apiKey === 'string' && !this.secure()) throw new Error('Secure storage is unavailable. Unlock your system keychain to save an API key.');
    const current = this.get();
    if (typeof input.apiKey === 'string') this.write('dictation-openai-key.bin', this.storage.encryptString(input.apiKey.trim()));
    else if (input.apiKey === null) rmSync(this.file('dictation-openai-key.bin'), { force: true });
    if (input.engine !== undefined || input.openaiLiveTranscription !== undefined) this.write('dictation.json', JSON.stringify({
      engine: input.engine ?? current.engine,
      openaiLiveTranscription: input.openaiLiveTranscription ?? current.openaiLiveTranscription,
    }));
    return this.get();
  }
  apiKey(): string | undefined {
    if (!existsSync(this.file('dictation-openai-key.bin'))) return undefined;
    if (!this.secure()) throw new Error('Secure storage is unavailable. Unlock your system keychain.');
    try { return this.storage.decryptString(readFileSync(this.file('dictation-openai-key.bin'))); }
    catch { throw new Error('Unable to unlock the OpenAI API key. Save it again in Dictation settings.'); }
  }
  private write(name: string, value: string | Buffer): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = this.file(name);
    const temporary = `${target}.tmp`;
    try { writeFileSync(temporary, value, { mode: 0o600 }); renameSync(temporary, target); }
    finally { rmSync(temporary, { force: true }); }
  }
}
