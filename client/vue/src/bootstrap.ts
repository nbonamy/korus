import { createApp } from 'vue';
import type { AppClient } from '@workspace/core/client';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import '@codex-app-sdk/vue/styles.css';
import './styles/variables.css';
import './styles/theme.css';
import './styles/base.css';
import App from './App.vue';
import AnnotationOverlayApp from './AnnotationOverlayApp.vue';
import { i18n } from './i18n';
import { applyRendererPlatform } from './renderer-platform';
import { configureAppClient } from './platform-api';
import { product } from '@workspace/core/product';

export type MountAppVueAppOptions = {
  client: AppClient;
  surface?: 'annotation-overlay' | 'main';
  target?: Element | string;
};

export function mountAppVueApp(options: MountAppVueAppOptions) {
  document.title = product.name;
  configureAppClient(options.client);
  applyRendererPlatform(document.documentElement, navigator.platform, navigator.userAgent, options.client.platform !== 'web');

  const surface = options.surface
    ?? (new URLSearchParams(window.location.search).get('surface') === 'annotation-overlay'
      ? 'annotation-overlay'
      : 'main');
  const rootComponent = surface === 'annotation-overlay' ? AnnotationOverlayApp : App;
  document.documentElement.dataset.surface = surface;

  return createApp(rootComponent)
    .use(ElementPlus)
    .use(i18n)
    .mount(options.target ?? '#app');
}
