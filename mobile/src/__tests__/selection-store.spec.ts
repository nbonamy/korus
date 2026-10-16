import { describe, expect, it, vi } from 'vitest';
import { createSelectionStore } from '../selection-store';

describe('saved mobile selection', () => {
  it.each(['not json', 'null', '{"teamId":3,"agentId":"agent"}'])('ignores damaged navigation preferences: %s', async (value) => {
    const store = createSelectionStore({ read: async () => ({ value }), write: async () => {}, remove: async () => {} });
    expect(await store.read('laptop')).toBeNull();
  });

  it('serializes rapid selection changes and forgetting so a slow write cannot resurrect an old selection', async () => {
    let value: string | null = null;
    let finish!: () => void;
    const write = vi.fn(async (next: { value: string }) => { value = next.value; })
      .mockImplementationOnce(async (next) => { await new Promise<void>((resolve) => { finish = resolve; }); value = next.value; });
    const store = createSelectionStore({ read: async () => ({ value }), write, remove: async () => { value = null; } });
    const first = store.write('laptop', { teamId: 'team', agentId: 'first' });
    const second = store.write('laptop', { teamId: 'team', agentId: 'second' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(write).toHaveBeenCalledTimes(1);
    finish(); await Promise.all([first, second]);
    expect(await store.read('laptop')).toEqual({ teamId: 'team', agentId: 'second' });
    await Promise.all([store.write('laptop', { teamId: 'team', agentId: 'third' }), store.remove('laptop')]);
    expect(await store.read('laptop')).toBeNull();
  });

  it('can save the next selection after device storage rejects a write', async () => {
    let value: string | null = null;
    const write = vi.fn(async (next: { value: string }) => { value = next.value; }).mockRejectedValueOnce(new Error('Locked'));
    const store = createSelectionStore({ read: async () => ({ value }), write, remove: async () => {} });
    await expect(store.write('laptop', { teamId: 'team', agentId: 'first' })).rejects.toThrow('Locked');
    await store.write('laptop', { teamId: 'team', agentId: 'second' });
    expect(await store.read('laptop')).toEqual({ teamId: 'team', agentId: 'second' });
  });
});
