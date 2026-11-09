import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DictationSettingsStore } from '../dictation-settings';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
function setup(platform = 'darwin', secure = true) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dictation-'));
  directories.push(directory);
  const crypto = {
    isEncryptionAvailable: () => secure,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: vi.fn((value: string) => Buffer.from(value.split('').reverse().join(''))),
    decryptString: vi.fn((value: Buffer) => value.toString().split('').reverse().join('')),
  };
  return { directory, crypto, store: new DictationSettingsStore(directory, crypto, platform) };
}
describe('desktop dictation settings', () => {
  it('defaults per platform and persists engine and encrypted credentials without returning the key', () => {
    const { store, directory, crypto } = setup();
    expect(store.get()).toStrictEqual({ engine: 'apple', openaiLiveTranscription: false, appleAvailable: true, hasApiKey: false, secureStorageAvailable: true });
    expect(store.update({ engine: 'openai', apiKey: 'test-secret' })).toStrictEqual({ engine: 'openai', openaiLiveTranscription: false, appleAvailable: true, hasApiKey: true, secureStorageAvailable: true });
    expect(readFileSync(path.join(directory, 'dictation.json'), 'utf8')).not.toContain('test-secret');
    expect(readFileSync(path.join(directory, 'dictation-openai-key.bin'), 'utf8')).not.toContain('test-secret');
    store.update({ openaiLiveTranscription: true });
    const restored = new DictationSettingsStore(directory, crypto, 'darwin');
    expect(restored.get().engine).toBe('openai');
    expect(restored.get().openaiLiveTranscription).toBe(true);
    expect(restored.apiKey()).toBe('test-secret');
    restored.update({ apiKey: null });
    expect(restored.get().hasApiKey).toBe(false);
    expect(restored.apiKey()).toBeUndefined();
    expect(restored.get().openaiLiveTranscription).toBe(true);
    restored.update({ engine: 'apple' });
    expect(restored.get().openaiLiveTranscription).toBe(true);
  });
  it('rejects insecure storage and invalid input without persisting secrets', () => {
    const { store, crypto } = setup('linux', false);
    expect(store.get()).toStrictEqual({ engine: 'openai', openaiLiveTranscription: false, appleAvailable: false, hasApiKey: false, secureStorageAvailable: false });
    expect(() => store.update({ apiKey: 'test-secret' })).toThrow('Secure storage');
    expect(() => store.update({ engine: 'apple' })).toThrow('unavailable');
    expect(() => store.update({ apiKey: 123 } as never)).toThrow('Invalid');
    expect(() => store.update({ openaiLiveTranscription: 'yes' } as never)).toThrow('Invalid');
    expect(crypto.encryptString).not.toHaveBeenCalled();
  });
  it('rejects Linux basic_text even when Electron reports encryption available', () => {
    const { directory, crypto } = setup('linux');
    crypto.getSelectedStorageBackend = () => 'basic_text';
    const store = new DictationSettingsStore(directory, crypto, 'linux');
    expect(() => store.update({ apiKey: 'test-secret' })).toThrow('Secure storage');
  });
});
