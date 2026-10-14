import { describe, expect, it, vi } from 'vitest';
import { createNativeVault } from '../native-vault';

describe('native Keychain vault', () => {
  it('does not acknowledge an identity or pairing write the Keychain refused', async () => {
    const native = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const vault = createNativeVault(native);
    await expect(vault.write({ key: 'device-identity', value: 'identity' })).rejects.toThrow();
    await expect(vault.write({ key: 'paired-hosts', value: 'pairings' })).resolves.toBeUndefined();
    expect(native.mock.calls).toStrictEqual([
      [{ type: 'vault.write', key: 'device-identity', value: 'identity' }],
      [{ type: 'vault.write', key: 'paired-hosts', value: 'pairings' }],
    ]);
  });
});
