import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { createCompanionRelay } from '../relay';

/** Real WebSocket upgrade and multistream negotiation; stop before Noise/provider traffic. */
function negotiate(port: number, source?: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, headers: { Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      ...(source ? { 'X-Real-IP': source } : {}) } });
    req.on('error', reject);
    req.on('response', response => { response.resume(); resolve(false); });
    req.on('upgrade', (_response, socket, head) => {
      let admitted = false;
      socket.setTimeout(2000, () => socket.destroy(new Error('Negotiation timed out')));
      socket.on('error', reject);
      socket.on('end', () => socket.destroy());
      const receive = (data: Buffer) => { admitted = (data[0]! & 0x0f) === 2; socket.destroy(); };
      socket.on('data', receive);
      if (head.length) receive(head);
      socket.on('close', () => resolve(admitted));
      const payload = Buffer.from('\x13/multistream/1.0.0\n\x07/noise\n');
      const mask = randomBytes(4);
      socket.write(Buffer.concat([Buffer.from([0x82, 0x80 | payload.length]), mask, Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!))]));
    });
    req.end();
  });
}
describe('relay source admission through WebSocket upgrades', () => {
  it('limits each trusted proxy source independently and rejects missing or forged address lists', async () => {
    const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws', trustedProxy: true });
    const port = Number(relay.getMultiaddrs()[0]!.getComponents().find(part => part.name === 'tcp')!.value);
    try {
      for (let n = 0; n < 60; n++) expect(await negotiate(port, '192.0.2.1')).toBe(true);
      expect(await negotiate(port, '192.0.2.1')).toBe(false);
      expect(await negotiate(port, '192.0.2.2')).toBe(true);
      expect(await negotiate(port)).toBe(false);
      expect(await negotiate(port, '192.0.2.3, 192.0.2.4')).toBe(false);
    } finally { await relay.stop(); }
  });
  it('ignores spoofed proxy headers unless proxy mode is explicitly enabled', async () => {
    const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/ws' });
    const port = Number(relay.getMultiaddrs()[0]!.getComponents().find(part => part.name === 'tcp')!.value);
    try {
      for (let n = 0; n < 60; n++) expect(await negotiate(port, `192.0.2.${n + 1}`)).toBe(true);
      expect(await negotiate(port, '192.0.2.200')).toBe(false);
    } finally { await relay.stop(); }
  });
});
