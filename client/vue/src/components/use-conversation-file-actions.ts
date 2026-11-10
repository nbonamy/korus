import { computed, ref } from 'vue';
import { conversationLinkFromHref as codexConversationLinkFromHref } from '@korus-dev/agent-ui-sdk';
import type { Agent } from '@workspace/core/contracts';
import { appApi, appHostCapabilities } from '../platform-api';
import { translate } from '../i18n';
import { rendererPlatform } from '../renderer-platform';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { DownloadIcon, ExternalLinkIcon, FolderOpenIcon } from '../shared/icons/app-icons';

export function useConversationFileActions(options: {
  agent: (id: string) => Agent | undefined;
  download: (agentId: string, path: string) => Promise<void>;
  reportError: (message: string) => void;
}) {
  const menu = ref<{ agentId: string; path: string; x: number; y: number } | null>(null);
  const close = () => { menu.value = null; };
  const nativeAvailable = () => appHostCapabilities.openInApplications && Boolean(appApi?.openAgentFile);
  const local = (agent: Agent | undefined) => Boolean(agent && !agent.remoteConnectionId && !agent.sharedConversation && nativeAvailable());
  const items = computed<AppMenuItem[]>(() => {
    const enabled = menu.value && local(options.agent(menu.value.agentId));
    const platform = rendererPlatform(navigator.platform, navigator.userAgent);
    const revealLabel = platform === 'macos' ? 'chat.fileActions.finder'
      : platform === 'windows' ? 'chat.fileActions.folder' : 'chat.fileActions.fileManager';
    return [
      { id: 'open', type: 'action', label: translate('chat.fileActions.open'), icon: ExternalLinkIcon, disabled: !enabled },
      { id: 'reveal', type: 'action', label: translate(revealLabel), icon: FolderOpenIcon, disabled: !enabled },
      { id: 'download', type: 'action', label: translate('chat.fileActions.download'), icon: DownloadIcon },
    ];
  });
  function capture(event: MouseEvent): void {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    const href = anchor?.getAttribute('href');
    const agentId = anchor?.closest('[data-conversation-agent-id]')?.getAttribute('data-conversation-agent-id');
    if (!href || href.startsWith('#') || !agentId || !options.agent(agentId)) return;
    const link = codexConversationLinkFromHref(href);
    if (!link || link.kind !== 'file') return;
    event.preventDefault();
    event.stopPropagation();
    menu.value = { agentId, path: link.path, x: event.clientX, y: event.clientY };
  }
  async function openNative(agentId: string, path: string, action: 'open' | 'reveal' = 'open'): Promise<void> {
    if (!local(options.agent(agentId))) throw new Error(translate('chat.fileActions.localOnly'));
    await appApi!.openAgentFile!(agentId, path, action);
  }
  async function select(action: string): Promise<void> {
    const request = menu.value;
    close();
    if (!request || !options.agent(request.agentId)) return;
    try {
      if (action === 'download') await options.download(request.agentId, request.path);
      else if (action === 'open' || action === 'reveal') await openNative(request.agentId, request.path, action);
    } catch (error) {
      options.reportError(error instanceof Error ? error.message : String(error));
    }
  }
  return { menu, items, close, capture, select, openNative, nativeAvailable };
}
