import { createApp, h, ref } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createMission } from '@workspace/core/missions';
import AgentSidebar from '../../../AgentSidebar.vue';

const snapshot = createInitialSnapshot();
const mission = createMission(snapshot, { outcome: 'Example mission', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
createApp({ setup() {
  const width = ref(260);
  const existingMission = ref(true);
  const action = ref('');
  return () => h('main', { style: 'height:100%;display:flex' }, [
    h(AgentSidebar, { agents: [], activeAgentId: null, teamName: 'Team', width: width.value, missions: existingMission.value ? [mission] : [],
      onCreateQuickChat: () => { action.value = 'quick-chat'; }, onStartWork: (value: string) => { action.value = value; } }),
    h('div', [
      h('select', { 'aria-label': 'Sidebar width', onChange: (event: Event) => { width.value = Number((event.target as HTMLSelectElement).value); } }, [200, 260, 420].map(value => h('option', { value, selected: value === width.value }, String(value)))),
      h('button', { onClick: () => { existingMission.value = !existingMission.value; } }, 'Toggle existing mission'),
      h('output', { 'aria-label': 'Selected action' }, action.value),
    ]),
  ]);
} }).use(ElementPlus).use(i18n).mount('#app');
