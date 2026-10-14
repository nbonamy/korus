import { describe, expect, it } from 'vitest';
import { relayAddress } from '../companion-relay';
const peer = '12D3KooW'.padEnd(52, 'a');
describe('companion relay configuration', () => {
  it('permits explicit local development WS without allowing public or malformed origins', () => {
    for (const origin of ['ws://192.168.1.16:47801', 'ws://10.0.0.2:9000', 'ws://172.16.0.1:9000', 'ws://laptop.local:47801']) {
      expect(() => relayAddress(origin, peer)).toThrow();
      expect(relayAddress(origin, peer, true)).toContain('/ws/p2p/');
    }
    for (const origin of ['ws://relay.example:9000', 'ws://8.8.8.8:9000', 'ws://172.32.0.1:9000', 'ws://laptop.local.evil:9000', 'ws://user:password@laptop.local:9000', 'ws://laptop.local:9000/path']) {
      expect(() => relayAddress(origin, peer, true)).toThrow();
    }
  });
  it('pins the configured peer over WSS and admits plaintext only on loopback', () => {
    expect(relayAddress('wss://relay.example', peer)).toBe(`/dns4/relay.example/tcp/443/tls/ws/p2p/${peer}`);
    expect(relayAddress('wss://[::1]:9000', peer)).toBe(`/ip6/::1/tcp/9000/tls/ws/p2p/${peer}`);
    expect(relayAddress('ws://127.0.0.1:9000', peer)).toBe(`/ip4/127.0.0.1/tcp/9000/ws/p2p/${peer}`);
    expect(relayAddress('ws://localhost:9000', peer)).toBe(`/dns4/localhost/tcp/9000/ws/p2p/${peer}`);
    for (const origin of ['ws://relay.example', 'ws://192.168.1.5:9000', 'wss://user:password@relay.example', 'wss://relay.example/?token=x', 'wss://relay.example/path']) {
      expect(() => relayAddress(origin, peer)).toThrow();
    }
  });
});
