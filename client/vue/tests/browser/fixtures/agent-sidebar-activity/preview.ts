import { createApp, h } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../src/styles/variables.css';
import '../../../../src/styles/theme.css';
import '../../../../src/styles/base.css';
import { i18n } from '../../../../src/i18n';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import AgentSidebar from '../../../../src/components/AgentSidebar.vue';

// One agent in each activity section: needs input, working, done (recent) and idle (old).
const snapshot = createInitialSnapshot();
const base = snapshot.agents[0]!;
const agent = (id: string, status: typeof base.status, updatedAt: string) => ({ ...base, id, name: id, status, updatedAt });
const agents = [
  agent('needs-input', { type: 'awaitingInput' }, new Date().toISOString()),
  agent('working', { type: 'working' }, new Date().toISOString()),
  agent('done', { type: 'idle' }, new Date().toISOString()),
  agent('idle', { type: 'idle' }, '2026-01-01T00:00:00.000Z'),
];
createApp({ setup: () => () => h('main', { style: 'height:100%;display:flex' }, [
  h(AgentSidebar, { agents, activeAgentId: null, teamName: 'Team', width: 260, missions: [] }),
]) }).use(ElementPlus).use(i18n).mount('#app');
