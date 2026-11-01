import { describe, expect, it } from 'vitest';
import { relayStartupMessage } from '../relay-startup-error';

describe('relay startup diagnostics', () => {
  it('explains a listener collision nested inside transport errors', () => {
    const error = new AggregateError([new Error('transport failed', {
      cause: Object.assign(new Error('private diagnostic'), { code: 'EADDRINUSE', port: 47800 }),
    })]);
    expect(relayStartupMessage(error)).toMatch(/port 47800.*already in use/i);
    expect(relayStartupMessage(error)).toMatch(/running relay/i);
  });

  it('recognizes libp2p listener errors that preserve only a formatted OS error', () => {
    const error = Object.assign(new Error('Some configured addresses failed:\n /ip4/127.0.0.1/tcp/47800/ws: listen EADDRINUSE: address already in use 127.0.0.1:47800\nprivate material'), {
      name: 'UnsupportedListenAddressesError',
    });
    expect(relayStartupMessage(error)).toMatch(/port 47800.*already in use/i);
    expect(relayStartupMessage(error)).not.toContain('private material');
  });

  it.each([
    ['EACCES', /permission/i],
    ['ENOENT', /missing/i],
    ['EADDRNOTAVAIL', /address.*available/i],
    ['ERR_OSSL_PEM_NO_START_LINE', /TLS certificate.*private key/i],
  ])('explains %s without leaking raw error contents', (code, expected) => {
    const message = relayStartupMessage(Object.assign(new Error('secret certificate content'), { code }));
    expect(message).toMatch(expected);
    expect(message).not.toContain('secret certificate content');
  });

  it('keeps unknown errors private, including cyclic causes', () => {
    const error = Object.assign(new Error('private-key-material'), { code: 'secret-code', cause: undefined as unknown });
    error.cause = error;
    expect(relayStartupMessage(error)).toMatch(/unexpected/i);
    expect(relayStartupMessage(error)).not.toContain('private-key-material');
    expect(relayStartupMessage(error)).not.toContain('secret-code');
  });
});
