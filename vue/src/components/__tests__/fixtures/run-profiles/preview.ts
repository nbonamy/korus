import { createApp, h, ref } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import { configureAppClient } from '../../../../platform-api';
import { createAppBrowserClient } from '../../../../../../web/src/browser-client';
import RunProfilesControl from '../../../RunProfilesControl.vue';
import type { Agent } from '@workspace/core/contracts';

// Real app transport and owning daemon. The query parameter names the isolated preview server.
const backend = new URLSearchParams(location.search).get('backend');
if (!backend || !/^\d+$/.test(backend)) throw new Error('Pass the isolated web server port as ?backend=<port>.');
const api = createAppBrowserClient({ createSocket: () => new WebSocket(`ws://127.0.0.1:${backend}/app?clientId=run-profile-fixture`) });
configureAppClient({ api, platform: 'web' });
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
