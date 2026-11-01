import { createApp, h } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '../../../../styles/variables.css';
import '../../../../styles/theme.css';
import '../../../../styles/base.css';
import { i18n } from '../../../../i18n';
import { configureAppClient } from '../../../../platform-api';
import BrowserPanel from '../../../BrowserPanel.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';

const state = { url: 'https://example.com/', title: 'Example preview', canGoBack: false, canGoForward: false };
const noop = async () => {};
const snapshot = createInitialSnapshot();
configureAppClient({
  platform: 'desktop',
  api: {
    browserOpen: async () => state,
    browserNavigate: async () => state,
    browserGetZoom: async () => 100,
    browserSetBounds: noop,
    browserClose: noop,
    updateSettings: async (patch: { general: Partial<typeof snapshot.general> }) => {
      snapshot.general = { ...snapshot.general, ...patch.general };
      return structuredClone(snapshot);
    },
    onEvent: () => () => {},
    onAppCommand: () => () => {},
  } as any,
});

// Simulate the Electron guest boundary; the toolbar and dialog remain real.
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement && node.tagName === 'WEBVIEW') {
        Object.assign(node, { getWebContentsId: () => 42 });
        queueMicrotask(() => node.dispatchEvent(new Event('dom-ready')));
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

createApp({
  setup: () => () => h('main', { style: 'height:100vh;display:flex;flex-direction:column' }, [
    h('button', { id: 'outside', style: 'align-self:flex-start;margin:12px' }, 'Outside address bar'),
    h(BrowserPanel, { agentId: 'focus-preview', initialUrl: state.url }),
  ]),
}).use(ElementPlus).use(i18n).mount('#app');
