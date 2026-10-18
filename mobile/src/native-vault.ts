import type { ProtectedVault } from './protected-storage';

/** Protected storage persistence is acknowledged by the host, not by bridge delivery alone. */
export function createNativeVault(request: <Result>(message: Record<string, unknown>) => Promise<Result>): ProtectedVault {
  return {
    read: ({ key }) => request({ type: 'vault.read', key }),
    write: async ({ key, value }) => {
      if (await request({ type: 'vault.write', key, value }) !== true) throw new Error('Device storage could not save the pairing.');
    },
    remove: async ({ key }) => { await request({ type: 'vault.remove', key }); },
  };
}
