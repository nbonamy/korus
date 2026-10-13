import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@codex-app-sdk/vue/styles.css';
import '@workspace/vue/styles/variables.css';
import '@workspace/vue/styles/theme.css';
import '@workspace/vue/styles/base.css';
import { i18n } from '@workspace/vue/i18n';
import { applyAppTheme, subscribeToSystemAppearance } from '@workspace/vue/theme/apply-theme';
import MobileShell from './MobileShell.vue';
import { createRelayConnector } from './relay-connector';
import { createMobileHost } from './mobile-host';
import { companionMessages } from './messages';
import { Capacitor } from '@capacitor/core';
import { createNativeDraftStore, protectedVault } from './protected-storage';

document.documentElement.dataset.platform = 'other';
i18n.global.mergeLocaleMessage('en', companionMessages);
applyAppTheme({ id: 'app-light', mode: 'system', uiFontSize: 15, chatFontSize: 16, codeFontSize: 13 });
const removeAppearance = subscribeToSystemAppearance();
const app = createApp(MobileShell, { connector: createRelayConnector(protectedVault, __COMPANION_RELAY__), host: createMobileHost(),
  draftStore: Capacitor.isNativePlatform() ? createNativeDraftStore() : undefined }).use(ElementPlus).use(i18n);
app.mount('#app');
window.addEventListener('pagehide', () => { app.unmount(); removeAppearance(); }, { once: true });
