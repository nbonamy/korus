import { describe, expect, it } from 'vitest';
import { parseRelayConfig, runCompanionRelay } from '../relay-cli';
import { relayStartupMessage } from '../relay-startup-error';

const host = '12D3KooW'.padEnd(52, 'h');
const base = { hostIds: [host], stateDirectory: '/state' };
describe('relay operator configuration', () => {
  it('prints actionable configuration errors without echoing sensitive values', async () => {
    await expect(runCompanionRelay('')).rejects.toThrow(/configuration file.*first argument/);
    for (const source of ['{"secret":"private-key-material",', JSON.stringify({ ...base, listen: 'private-key-material' })]) {
      let failure: unknown;
      try { parseRelayConfig(source); } catch (error) { failure = error; }
      const diagnostic = relayStartupMessage(failure);
      expect(diagnostic).toMatch(/invalid operator configuration/i);
      expect(diagnostic).not.toContain('private-key-material');
    }
  });
  it('serves TLS with its certificate for public deployments', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/443/tls/ws', certificateFile: 'c', privateKeyFile: 'k' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/443/tls/ws' }))).toThrow('certificateFile');
  });
  it('allows plaintext only bound to loopback, for local development', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/127.0.0.1/tcp/47800/ws' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip6/::1/tcp/47800/ws' }))).not.toThrow();
    expect(() => parseRelayConfig(JSON.stringify({ ...base, listen: '/ip4/0.0.0.0/tcp/47800/ws' }))).toThrow('loopback');
  });
  it('allows public admission without an operator-maintained laptop list', () => {
    expect(parseRelayConfig(JSON.stringify({ stateDirectory: '/state', listen: '/ip4/127.0.0.1/tcp/47800/ws' })).hostIds).toBeUndefined();
  });
  it('requires at least one admitted laptop when restricting admission', () => {
    expect(() => parseRelayConfig(JSON.stringify({ ...base, hostIds: [], listen: '/ip4/127.0.0.1/tcp/47800/ws' }))).toThrow();
  });
});
