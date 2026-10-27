import { describe, expect, it } from 'vitest';
import { friendlyHostName, resolveHostName } from '../host-name';

describe('laptop name offered at pairing', () => {
  it('prefers the name the person gave the computer', async () => {
    expect(await resolveHostName({ platform: 'darwin', computerName: async () => "Nicolas’s MacBook Pro\n", hostname: () => 'nicolass-macbook-pro.local' })).toBe('Nicolas’s MacBook Pro');
  });

  it('falls back to the network name without its domain when there is no computer name', async () => {
    expect(await resolveHostName({ platform: 'darwin', computerName: async () => { throw new Error('missing'); }, hostname: () => 'Studio-Mac.local' })).toBe('Studio-Mac');
    expect(await resolveHostName({ platform: 'linux', computerName: async () => 'ignored', hostname: () => 'build-box.example.net' })).toBe('build-box');
  });

  it('keeps names short, single-line and free of control characters', () => {
    expect(friendlyHostName(`  A\u0000 very\tlong name ${'x'.repeat(100)} `)).toBe(`A very long name ${'x'.repeat(43)}`);
    expect(friendlyHostName('   ')).toBe('');
  });
});
