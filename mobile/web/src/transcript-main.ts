import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@codex-app-sdk/vue/styles.css';
import '@workspace/vue/styles/variables.css';
import '@workspace/vue/styles/theme.css';
import '@workspace/vue/styles/base.css';
import { i18n } from '@workspace/vue/i18n';
import { applyAppTheme, subscribeToSystemAppearance } from '@workspace/vue/theme/apply-theme';
import TranscriptApp from './TranscriptApp.vue';
import { handler } from './native';

document.documentElement.dataset.platform = 'other';
applyAppTheme({ id: 'app-light', mode: 'system', uiFontSize: 15, chatFontSize: 20, codeFontSize: 13 });
subscribeToSystemAppearance();
createApp(TranscriptApp).use(ElementPlus).use(i18n).mount('#app');
void handler('transcript').postMessage(JSON.stringify({ type: 'ready' }));
