<template>
  <BrowserPanel v-bind="paneProps" :host="host" :document="props.visualization" @send-prompt="emit('send-prompt', $event)" @url-change="emit('url-change', $event)" @open-browser-settings="emit('open-browser-settings')" />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { BrowserPanel, type BrowserUiHost } from 'ai-app-sdk/browser-ui';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import { PRIMARY_BROWSER_ID } from '@workspace/core/contracts';
import { normalizeBrowserBookmarks } from '@workspace/core/browser-bookmarks';
import { appApi, appClientPlatform } from '../platform-api';
import { useAppState } from '../app-state';
import { translate } from '../i18n';
import { openInExternalBrowser } from './browser-external';
import { browserExtensionIcon } from './browser-extension-icons';
const props = withDefaults(defineProps<{
  agentId: string; browserId?: string; initialUrl?: string; openRequestId?: number; visible?: boolean;
  visualization?: { path: string; title: string } | null;
}>(), { browserId: PRIMARY_BROWSER_ID, initialUrl: '', openRequestId: 0, visible: true, visualization: null });
const emit = defineEmits<{ 'send-prompt': [prompt: string]; 'url-change': [url: string]; 'open-browser-settings': [] }>();
const paneProps = computed(() => { const { visualization: _document, ...rest } = props; return rest; });
const appState = useAppState();
const host: BrowserUiHost = {
  platform: appClientPlatform === 'desktop' ? 'desktop' : 'web',
  api: appApi ? { ...appApi, browserOpenDocument: (...args) => appApi!.browserOpenVisualization(...args) } : undefined,
  guestPartition: browserGuestPartition,
  bookmarks: () => normalizeBrowserBookmarks(appState.snapshot.value.general.browserBookmarks),
  saveBookmarks: async bookmarks => { await appState.updateSettings({ general: { browserBookmarks: bookmarks } }); },
  extensionIcon: browserExtensionIcon, openExternal: openInExternalBrowser, translate,
  onEvent: listener => appApi?.onEvent(event => { if (event.type === 'browser.annotationCreated') listener(event); }) ?? (() => {}),
  onViewportRequest: listener => appApi?.onAppCommand(command => { if (command.type === 'set-browser-viewport') listener(command); }) ?? (() => {}),
};
</script>
