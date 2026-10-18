import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeMessageBridge, type NativeMessagePort } from '../native-message-bridge';
import { createNativeVault } from '../native-vault';

afterEach(() => vi.useRealTimers());
function fixture() {
  const sent: { channel: string; message: unknown; id?: string }[] = [];
  const port: NativeMessagePort = { postMessage: text => { sent.push(JSON.parse(text)); } };
  const bridge = createNativeMessageBridge(port);
  return { bridge, port, sent, reply: (value: unknown) => port.onmessage?.({ data: JSON.stringify(value) }) };
}

describe('native Android message boundary', () => {
  it('matches concurrent native replies and requires secure-storage acknowledgement before reporting a saved pairing', async () => {
    const f = fixture();
    const vault = createNativeVault(message => f.bridge.handler('native').postMessage(message) as Promise<never>);
    const saved = vault.write({ key: 'pairing', value: 'private identity' });
    const read = vault.read({ key: 'selection' });
    expect(f.sent.map(({ channel, message }) => ({ channel, message }))).toStrictEqual([
      { channel: 'native', message: { type: 'vault.write', key: 'pairing', value: 'private identity' } },
      { channel: 'native', message: { type: 'vault.read', key: 'selection' } },
    ]);
    f.reply({ id: f.sent[1]!.id, result: { value: 'saved selection' } });
    f.reply({ id: f.sent[0]!.id, result: false });
    expect(await read).toStrictEqual({ value: 'saved selection' });
    await expect(saved).rejects.toThrow('could not save');
    f.bridge.dispose();
  });
  it('forwards engine and transcript events without treating them as native requests', () => {
    const f = fixture();
    f.bridge.handler('engine').postMessage({ type: 'state', json: '{"connection":"connected"}' });
    f.bridge.handler('transcript').postMessage('{"type":"loadOlder","agentId":"agent"}');
    expect(f.sent).toStrictEqual([
      { channel: 'engine', message: { type: 'state', json: '{"connection":"connected"}' } },
      { channel: 'transcript', message: '{"type":"loadOlder","agentId":"agent"}' },
    ]);
    f.bridge.dispose();
  });
  it('does not resolve a request from a stale reply and surfaces host failures without losing the bridge', async () => {
    const f = fixture(); const request = f.bridge.handler('native').postMessage({ type: 'relay' });
    f.reply({ id: 'stale', result: 'wrong host' });
    f.reply({ id: f.sent[0]!.id, error: 'Storage unavailable.' });
    await expect(request).rejects.toThrow('Storage unavailable');
    const next = f.bridge.handler('native').postMessage({ type: 'relay' });
    f.reply({ id: f.sent[1]!.id, result: { origin: 'wss://relay.example' } });
    await expect(next).resolves.toStrictEqual({ origin: 'wss://relay.example' });
    f.bridge.dispose();
  });
  it('settles pending calls when the native host disappears or the page is destroyed', async () => {
    vi.useFakeTimers(); const f = fixture();
    const request = f.bridge.handler('native').postMessage({ type: 'relay' });
    const timedOut = expect(request).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000); await timedOut;
    const late = f.bridge.handler('native').postMessage({ type: 'vault.read', key: 'pairing' });
    const closed = expect(late).rejects.toThrow('closed'); f.bridge.dispose(); await closed;
    f.reply({ id: f.sent[1]!.id, result: { value: 'late secret' } });
    await expect(f.bridge.handler('native').postMessage({ type: 'relay' })).rejects.toThrow('closed');
  });
});
