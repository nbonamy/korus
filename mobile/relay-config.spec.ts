// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { configuredRelay } from './relay-config';

const peerId = '12D3KooWFvcCybZCDxxiUYY247TDpaSanCyB3PBm5Ck8VZr6ujor';

describe('deployment relay configuration', () => {
  it('reads only the relay keys from .env and lets the environment override them', () => {
    const dotenv = `OTHER_SECRET=ignored\nAPP_COMPANION_RELAY_URL=wss://localhost:47800\nAPP_COMPANION_RELAY_PEER_ID=${peerId}\n`;
    expect(configuredRelay({}, dotenv)).toStrictEqual({ origin: 'wss://localhost:47800', peerId });
    expect(configuredRelay({ APP_COMPANION_RELAY_URL: 'wss://relay.example.com' }, dotenv)).toStrictEqual({ origin: 'wss://relay.example.com', peerId });
  });
  it('reads a public relay for the phone build from CI variables', () => {
    expect(configuredRelay({ APP_COMPANION_RELAY_URL: 'wss://relay.example.com', APP_COMPANION_RELAY_PEER_ID: peerId }, '')).toStrictEqual({ origin: 'wss://relay.example.com', peerId });
  });
  it('is absent when nothing is configured and refuses insecure or partial values', () => {
    expect(configuredRelay({}, '')).toBeNull();
    expect(() => configuredRelay({ APP_COMPANION_RELAY_URL: 'ws://relay.example.com', APP_COMPANION_RELAY_PEER_ID: peerId }, '')).toThrow('APP_COMPANION_RELAY');
    expect(configuredRelay({ APP_COMPANION_RELAY_URL: 'ws://localhost:47800', APP_COMPANION_RELAY_PEER_ID: peerId }, '')).toStrictEqual({ origin: 'ws://localhost:47800', peerId });
    expect(() => configuredRelay({ APP_COMPANION_RELAY_URL: 'wss://relay.example.com/path', APP_COMPANION_RELAY_PEER_ID: peerId }, '')).toThrow('APP_COMPANION_RELAY');
    expect(() => configuredRelay({ APP_COMPANION_RELAY_PEER_ID: peerId }, '')).toThrow('APP_COMPANION_RELAY');
  });
});
