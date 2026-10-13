import { describe, expect, it } from 'vitest';
import { relayAddress } from '../companion-relay';
const peer = '12D3KooW'.padEnd(52, 'a');
describe('companion relay configuration', () => {
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
