import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { GuestJoinControl, GuestJoinState, GuestJoinView } from '@workspace/core/guest-navigation';
import { appApi, appClientPlatform } from './platform-api';

/** Team navigation stays app-owned; only protected authorization lives in the daemon. */
export function useGuestNavigation(snapshot: () => AppSnapshot, selectAgent: (id: string) => Promise<void>, ready: () => boolean) {
  const inviteVisible = ref(false); const state = ref<GuestJoinState>({ entries: [], view: null });
  const inviteView = ref<GuestJoinView | null>(null);
  const busy = ref(false); const failed = ref(false);
  let disposed = false; let chain = Promise.resolve(true); let poll: ReturnType<typeof setTimeout> | undefined; let unsubscribe: (() => void) | undefined;
  let pendingInvite: string | undefined;
  let invitationGeneration = 0;
  function run(input: GuestJoinControl): Promise<boolean> {
    const generation = invitationGeneration;
    const invitationAction = input.action === 'prepare' || input.action === 'join';
    const work = chain.then(async () => {
      if (disposed || !appApi?.guestConversationControl || (invitationAction && generation !== invitationGeneration)) return false;
      const interactive = input.action !== 'state';
      if (interactive) { busy.value = true; failed.value = false; }
      try {
        const scoped = input.action === 'prepare' ? { ...input, teamId: ready() ? snapshot().activeTeamId ?? undefined : undefined } : input;
        let next = await appApi.guestConversationControl(scoped);
        if (invitationAction && generation !== invitationGeneration) {
          if (input.action === 'prepare' && next.view?.status === 'needsName') await appApi.guestConversationControl({ action: 'cancel', id: next.view.id });
          return false;
        }
        if (!disposed && input.action === 'prepare' && next.view?.status === 'needsName') {
          state.value = next;
          const displayName = snapshot().general.guestDisplayName?.trim();
          if (displayName) next = await appApi.guestConversationControl({ action: 'join', id: next.view.id, name: displayName });
        }
        if (!disposed) {
          state.value = next;
          if (input.action === 'prepare' || input.action === 'join') inviteView.value = next.view;
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
  function close() {
    const id = inviteView.value?.status === 'needsName' ? inviteView.value.id : undefined;
    ++invitationGeneration; inviteVisible.value = false; inviteView.value = null;
    if (id) void run({ action: 'cancel', id });
  }
  function show() { ++invitationGeneration; inviteView.value = null; failed.value = false; inviteVisible.value = true; }
  function openInvite(link: string) {
    if (!ready()) { pendingInvite = link; return; }
    const generation = ++invitationGeneration;
    inviteView.value = null;
    void run({ action: 'prepare', link }).then(() => {
      if (!disposed && generation === invitationGeneration) inviteVisible.value = failed.value || Boolean(inviteView.value && ['needsName', 'invalid', 'upgradeRequired'].includes(inviteView.value.status));
    });
  }
  watch(ready, loaded => {
    if (loaded && pendingInvite) { const link = pendingInvite; pendingInvite = undefined; openInvite(link); }
  });
  watch(() => snapshot().activeAgentId, id => {
    const joinId = snapshot().agents.find(agent => agent.id === id)?.sharedConversation?.joinId;
    if (joinId && appClientPlatform === 'desktop') void run({ action: 'open', id: joinId });
  });
  onMounted(() => {
    if (appClientPlatform !== 'desktop') return;
    unsubscribe = appApi?.onAppCommand(command => {
      if (command.type !== 'open-shared-conversation') return;
      openInvite(command.link);
    });
    void run({ action: 'state' }).then(() => {
      const id = snapshot().agents.find(agent => agent.id === snapshot().activeAgentId)?.sharedConversation?.joinId;
      if (id) void run({ action: 'open', id });
    }); poll = setTimeout(refresh, 750);
  });
  onBeforeUnmount(() => { disposed = true; pendingInvite = undefined; clearTimeout(poll); unsubscribe?.(); state.value = { entries: [], view: null }; });
  return { inviteVisible, inviteView, state, busy, failed, run, show, close };
}
