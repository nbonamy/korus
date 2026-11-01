import { createApp, h, ref } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import { configureAppClient } from '../../../../platform-api';
import type { AppApi } from '@workspace/core/contracts';
import RunProfilesControl from '../../../RunProfilesControl.vue';
import type { Agent } from '@workspace/core/contracts';

// Load this fixture in the isolated Electron renderer to use its owning daemon.
const api = (window as Window & { app?: AppApi }).app;
if (!api) throw new Error('This preview requires the Electron preload bridge.');
configureAppClient({ api, platform: 'desktop' });
createApp({
  setup() {
    const agent = ref<Agent | null>(null);
    void api.getSnapshot().then(value => { agent.value = value.agents[0] ?? null; });
    return () => h('main', { style: 'min-height:100vh;background:var(--color-surface-lowest);color:var(--color-text);' }, [
      h('header', { style: 'height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--color-border);' }, [
        h('strong', { style: 'font-size:13px;font-weight:500;' }, 'Repository commands'),
        agent.value ? h(RunProfilesControl, { agent: agent.value, hostLabel: 'Local host', previewAvailable: false }) : h('span', 'Loading…'),
      ]),
    ]);
  },
}).use(ElementPlus).use(i18n).mount('#app');
