import { createApp } from 'vue';
import '@workspace/vue/styles/variables.css';
import '@workspace/vue/styles/theme.css';
import '@workspace/vue/styles/base.css';
import { i18n } from '@workspace/vue/i18n';
import { applyAppTheme, subscribeToSystemAppearance } from '@workspace/vue/theme/apply-theme';
import ChangesApp from './ChangesApp.vue';
import { handler } from './native';

applyAppTheme({ id: 'app-light', mode: 'system', uiFontSize: 17, chatFontSize: 19, codeFontSize: 14 });
subscribeToSystemAppearance();
createApp(ChangesApp).use(i18n).mount('#app');
void handler('changes').postMessage({ type: 'ready' });
