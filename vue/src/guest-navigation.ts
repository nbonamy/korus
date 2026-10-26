import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { GuestJoinControl, GuestJoinState } from '@workspace/core/guest-navigation';
import { appApi, appClientPlatform } from './platform-api';

/** Bearer URLs are immediately handed to the daemon; only its safe projection enters Vue state. */
export function useGuestNavigation() {
  const visible = ref(false); const state = ref<GuestJoinState>({ entries: [], view: null });
  const busy = ref(false); const failed = ref(false);
  let disposed = false; let chain = Promise.resolve(); let sequence = 0; let poll: ReturnType<typeof setTimeout> | undefined; let unsubscribe: (() => void) | undefined;
  function run(input: GuestJoinControl): Promise<void> {
    const request = ++sequence;
    const work = chain.then(async () => {
      if (disposed || !appApi?.guestConversationControl) return;
      busy.value = true; failed.value = false;
      try { const next = await appApi.guestConversationControl(input); if (!disposed && request === sequence) state.value = next; }
      catch { if (!disposed && request === sequence) failed.value = true; }
      finally { if (!disposed) busy.value = false; }
    }); chain = work.catch(() => {}); return work;
  }
  async function refresh() {
    if (disposed) return;
    if (visible.value && !busy.value) await run({ action: 'state' });
    if (!disposed) poll = setTimeout(refresh, 750);
  }
  function show() { visible.value = true; void run({ action: 'state' }); }
  onMounted(() => {
    if (appClientPlatform !== 'desktop') return;
    unsubscribe = appApi?.onAppCommand(command => {
      if (command.type !== 'open-shared-conversation') return;
      visible.value = true; void run({ action: 'prepare', link: command.link });
    });
    void run({ action: 'state' }); poll = setTimeout(refresh, 750);
  });
  onBeforeUnmount(() => { disposed = true; sequence++; clearTimeout(poll); unsubscribe?.(); state.value = { entries: [], view: null }; });
  return { visible, state, busy, failed, run, show };
}
