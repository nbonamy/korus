import { createApp, h, ref } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import AgentHeader from '../../../AgentHeader.vue';
import type { Agent, AgentGitStatus } from '@workspace/core/contracts';

const branch = 'codex/feature-057-record-trading-actions';
const names = ['MartinXP', 'KentXP', 'DaveXP', 'An exceptionally long agent name that cannot fit inside a narrow conversation pane'];
const agents: Agent[] = names.map((name, index) => ({
  id: `agent-${index}`, name, avatar: '👋', folder: '/projects/trading-actions',
  backend: 'codex', backendDefaults: { kind: 'codex' },
  status: { type: 'working' }, statusText: 'Validating the recorded trading actions and checking the resulting account balances',
  createdAt: '', updatedAt: '',
}));
const gitStatus: AgentGitStatus = {
  folder: '/projects/trading-actions', repository: 'trading-actions', branch,
  ahead: 0, behind: 0, changedFiles: 1, addedLines: 12, removedLines: 4,
  hasUntracked: false, state: 'dirty', updatedAt: '',
};

createApp({
  setup() {
    const assigned = ref(0);
    const width = ref(480);
    return () => h('main', [
      h('select', { 'aria-label': 'Pane width', value: width.value, onChange: (event: Event) => { width.value = Number((event.target as HTMLSelectElement).value); } },
        [320, 480, 760, 1200].map(value => h('option', { value }, `${value}px`))),
      h('select', { 'aria-label': 'Assigned agent', value: assigned.value, onChange: (event: Event) => { assigned.value = Number((event.target as HTMLSelectElement).value); } },
        names.map((name, index) => h('option', { value: index }, name))),
      h('section', { id: 'pane', style: `width:${width.value}px;max-width:100%;height:300px;display:flex;flex-direction:column;border:1px solid var(--color-border)` }, [
        h(AgentHeader, { agent: agents[assigned.value], gitStatus, repositoryIcon: '📈', backendRuntime: { backend: 'codex', status: 'running' }, isLoading: false, sidebarCollapsed: false, class: 'agent-header--pane' }),
        h('div', { id: 'conversation', style: 'min-height:0;overflow:auto' }, Array.from({ length: 40 }, (_, index) => h('p', `Conversation message ${index + 1}`))),
      ]),
    ]);
  },
}).use(ElementPlus).use(i18n).mount('#app');
