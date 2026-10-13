import { describe, expect, it } from 'vitest';
import { parseRelayConfig } from '../relay-cli';

const host = '12D3KooW'.padEnd(52, 'h');
const base = { hostIds: [host], stateDirectory: '/state' };
describe('relay operator configuration', () => {
  it('serves TLS with its certificate for public deployments', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/443/tls/ws', certificateFile: 'c', privateKeyFile: 'k' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/443/tls/ws' }))).toThrow('certificateFile');
  });
  it('allows plaintext only bound to loopback, for local development', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/127.0.0.1/tcp/47800/ws' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip6/::1/tcp/47800/ws' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/47800/ws' }))).toThrow('loopback');
  });
  it('requires at least one admitted laptop', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, hostIds: [], listen: '/ip4/127.0.0.1/tcp/47800/ws' }))).toThrow();
  });
});
