import { shallowRef } from 'vue';
import type { CompanionSession } from './companion-port';

type RemoteStatus = 'idle' | 'loading' | 'loaded' | 'failed';
export type RemoteList<Item, Extra extends object> = { status: RemoteStatus; items: Item[] } & Extra;

/**
 * A list read from the laptop on demand, such as branches or repositories. An answer is only applied if nothing
 * invalidated the list while it travelled: `reset` (the context changed) and a different session both discard it.
 */
export function createRemoteList<Item, Extra extends object = Record<never, never>>(env: { session(): CompanionSession | null; connected(): boolean }, idleExtra: Extra) {
  const idle = (): RemoteList<Item, Extra> => ({ status: 'idle', items: [], ...idleExtra });
  const state = shallowRef<RemoteList<Item, Extra>>(idle());
  let epoch = 0;
  let inflight: Promise<void> | undefined;

  function reset() { ++epoch; inflight = undefined; state.value = idle(); }

  async function load(extra: Extra, read: (active: CompanionSession) => Promise<Item[]> | undefined): Promise<void> {
    const active = env.session(); const mine = ++epoch;
    state.value = { status: 'loading', items: [], ...extra };
    try {
      const pending = active && env.connected() ? read(active) : undefined;
      if (!pending) throw new Error('Unavailable.');
      const items = await pending;
      if (mine === epoch && active === env.session()) state.value = { status: 'loaded', items, ...extra };
    } catch {
      if (mine === epoch) state.value = { status: 'failed', items: [], ...extra };
    }
  }

  /** For lists read once per context: callers share the request in flight, and a loaded list is not read again. */
  function loadOnce(extra: Extra, read: (active: CompanionSession) => Promise<Item[]> | undefined): Promise<void> {
    if (inflight) return inflight;
    if (state.value.status === 'loaded') return Promise.resolve();
    const request = load(extra, read).finally(() => { if (inflight === request) inflight = undefined; });
    inflight = request;
    return request;
  }

  /** For a list that needs no request, such as one the laptop's engine does not support. */
  function settle(items: Item[]) { state.value = { status: 'loaded', items, ...idleExtra }; }

  return { state, load, loadOnce, settle, reset, get epoch() { return epoch; }, get pending() { return inflight; } };
}
