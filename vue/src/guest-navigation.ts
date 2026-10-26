import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { GuestJoinControl, GuestJoinState } from '@workspace/core/guest-navigation';
import { appApi, appClientPlatform } from './platform-api';

/** Team navigation stays app-owned; only protected authorization lives in the daemon. */
export function useGuestNavigation(snapshot: () => AppSnapshot, selectAgent: (id: string) => Promise<void>, ready: () => boolean) {
  const inviteVisible = ref(false); const state = ref<GuestJoinState>({ entries: [], view: null });
  const busy = ref(false); const failed = ref(false);
  let disposed = false; let chain = Promise.resolve(true); let poll: ReturnType<typeof setTimeout> | undefined; let unsubscribe: (() => void) | undefined;
  function run(input: GuestJoinControl): Promise<boolean> {
    const work = chain.then(async () => {
      if (disposed || !appApi?.guestConversationControl) return false;
      const interactive = input.action !== 'state';
      if (interactive) { busy.value = true; failed.value = false; }
      try {
        const scoped = input.action === 'prepare' ? { ...input, teamId: ready() ? snapshot().activeTeamId ?? undefined : undefined } : input;
        const next = await appApi.guestConversationControl(scoped);
        if (!disposed) {
          state.value = next;
          if (next.view && ['rejected', 'storageUnavailable'].includes(next.view.status)) inviteVisible.value = true;
          if (['prepare', 'join', 'open'].includes(input.action) && next.entries.some(entry => entry.id === next.view?.id)) {
            const agent = snapshot().agents.find(agent => agent.sharedConversation?.joinId === next.view?.id);
            if (agent && agent.id !== snapshot().activeAgentId) await selectAgent(agent.id);
          }
        }
        return true;
      }
      catch { if (!disposed) failed.value = true; return false; }
      finally { if (!disposed && interactive) busy.value = false; }
    }); chain = work; return work;
  }
  async function refresh() {
    if (disposed) return;
    const agent = snapshot().agents.find(agent => agent.id === snapshot().activeAgentId);
    if ((inviteVisible.value || agent?.sharedConversation) && !busy.value) await run({ action: 'state' });
    if (!disposed) poll = setTimeout(refresh, 750);
  }
  function show() { state.value = { ...state.value, view: null }; inviteVisible.value = true; }
  watch(() => snapshot().activeAgentId, id => {
    const joinId = snapshot().agents.find(agent => agent.id === id)?.sharedConversation?.joinId;
    if (joinId && appClientPlatform === 'desktop') void run({ action: 'open', id: joinId });
  });
  onMounted(() => {
    if (appClientPlatform !== 'desktop') return;
    unsubscribe = appApi?.onAppCommand(command => {
      if (command.type !== 'open-shared-conversation') return;
      void run({ action: 'prepare', link: command.link }).then(() => {
        if (!disposed) inviteVisible.value = failed.value || Boolean(state.value.view && ['needsName', 'invalid', 'upgradeRequired'].includes(state.value.view.status));
      });
    });
    void run({ action: 'state' }).then(() => {
      const id = snapshot().agents.find(agent => agent.id === snapshot().activeAgentId)?.sharedConversation?.joinId;
      if (id) void run({ action: 'open', id });
    }); poll = setTimeout(refresh, 750);
  });
  onBeforeUnmount(() => { disposed = true; clearTimeout(poll); unsubscribe?.(); state.value = { entries: [], view: null }; });
  return { inviteVisible, state, busy, failed, run, show };
}
