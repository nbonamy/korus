import type { ProtectedVault } from './protected-storage';

export type SavedSelection = { teamId: string; agentId: string };
export type SelectionStore = {
  read(laptopId: string): Promise<SavedSelection | null>;
  write(laptopId: string, selection: SavedSelection): Promise<void>;
  remove(laptopId: string): Promise<void>;
};

/** Device-local navigation preferences, isolated by the paired laptop identity. */
export function createSelectionStore(vault: ProtectedVault): SelectionStore {
  let writes = Promise.resolve();
  const key = (laptopId: string) => `last-selection:${laptopId}`;
  function enqueue(operation: () => Promise<void>) {
    const pending = writes.then(operation);
    writes = pending.catch(() => {});
    return pending;
  }
  return {
    async read(laptopId) {
      await writes;
      const { value } = await vault.read({ key: key(laptopId) });
      if (!value) return null;
      try {
        const saved: unknown = JSON.parse(value);
        if (saved && typeof saved === 'object' && 'teamId' in saved && typeof saved.teamId === 'string'
          && 'agentId' in saved && typeof saved.agentId === 'string') return { teamId: saved.teamId, agentId: saved.agentId };
      } catch { /* A damaged preference falls back to the first available conversation. */ }
      return null;
    },
    write(laptopId, selection) {
      const value = JSON.stringify(selection);
      return enqueue(() => vault.write({ key: key(laptopId), value }));
    },
    remove: (laptopId) => enqueue(() => vault.remove({ key: key(laptopId) })),
  };
}
