import { createApp, h, provide, reactive, ref, shallowRef } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import AgentHeader from '../../../AgentHeader.vue';
import AgentSidebar from '../../../AgentSidebar.vue';
import ConversationShareDialog from '../../../ConversationShareDialog.vue';
import type { Agent } from '@workspace/core/contracts';
import { conversationShareTarget, type ConversationShareControl } from '@workspace/core/conversation-sharing';
import { conversationShareActiveByAgentIdKey } from '../../../conversation-share-state';

// Presentation-only fixture. No credentials, provider sessions or relay connections.
const agent: Agent = { id: 'synthetic-owner', teamId: 'synthetic-team', name: 'Guest sharing demo', folder: '/synthetic/project', backend: 'codex', backendSession: { kind: 'codex', threadId: 'synthetic-thread' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };
const team = { id: agent.teamId!, name: 'Synthetic workspace', agentIds: [agent.id] };
createApp({
  setup() {
    const open = ref(false); const active = ref(false);
    const shareActiveByAgentId = reactive<Record<string, boolean>>({});
    provide(conversationShareActiveByAgentIdKey, shareActiveByAgentId);
    const target = shallowRef(conversationShareTarget(agent)!);
    const control = async (input: ConversationShareControl) => {
      if (window.app?.conversationShareControl) return window.app.conversationShareControl(input);
      if (input.action === 'create') active.value = true;
      if (input.action === 'revoke') active.value = false;
      return { state: { active: active.value, handle: active.value ? 'a'.repeat(32) : null, connectedGuests: active.value ? 0 : null, availability: 'ready' as const }, ...(['copy', 'create'].includes(input.action) ? { link: '[REDACTED SYNTHETIC LINK]' } : {}) };
    };
    return () => h('main', { style: 'display:flex;height:100vh;background:var(--color-shell-main);color:var(--color-text)' }, [
      h(AgentSidebar, { agents: [agent], activeAgentId: agent.id, teamId: team.id, teamName: team.name, teams: [team], width: 260, onShareAgent: () => { open.value = true; } }),
      h('section', { style: 'flex:1;min-width:0' }, [
        h(AgentHeader, { agent, shareAvailable: true, backendRuntime: { backend: 'codex', status: 'running' }, isLoading: false, sidebarCollapsed: false, onShare: () => { open.value = true; } }),
        h('div', { style: 'padding:32px;max-width:720px;margin:auto' }, [h('p', 'Synthetic conversation'), h('p', 'The owner keeps execution local. Guests can read the available history and propose messages for the owner to approve.')]),
      ]),
      open.value ? h(ConversationShareDialog, { target: target.value, control, onClose: () => { open.value = false; } }) : null,
    ]);
  },
}).use(ElementPlus).use(i18n).mount('#app');
