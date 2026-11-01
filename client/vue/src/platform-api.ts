
import { translate } from './i18n';
import {
  desktopAppHostCapabilities,
  webAppHostCapabilities,
  type AppClient,
  type AppHostCapabilities,
} from '@workspace/core/client';
import type { AppApi } from '@workspace/core/contracts';
import { ElMessageBox } from 'element-plus';

export const CODEX_APP_DEEP_LINK = 'codex://' as const;
export const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins' as const;

export type AppPlatformActions = {
  launchChatGpt(): void | Promise<void>;
  managePlugins(): void | Promise<void>;
  openExternal?: (url: string) => void | Promise<void>;
};

export let appApi: AppApi | undefined;
export let appHostCapabilities: Readonly<AppHostCapabilities> = webAppHostCapabilities;
export let appClientPlatform: AppClient['platform'] = 'web';
export let appPlatformActions: Readonly<AppPlatformActions> = webPlatformActions();

export function configureAppClient(client?: AppClient): void {
  appApi = client?.api;
  appClientPlatform = client?.platform ?? 'web';
  if (client?.platform === 'desktop') {
    appHostCapabilities = desktopAppHostCapabilities;
    appPlatformActions = desktopPlatformActions(client.api);
    return;
  }
  appHostCapabilities = webAppHostCapabilities;
  appPlatformActions = webPlatformActions();
}

function desktopPlatformActions(api: AppApi | undefined): Readonly<AppPlatformActions> {
  const launchChatGpt = async () => {
    if (typeof api?.launchChatGptApp !== 'function') {
      throw new Error(translate('surface.platform-api.chatGPTCouldNotBeLaunchedFromThisWindow'));
    }
    const result = await api.launchChatGptApp();
    if (result.status !== 'alreadyRunning') return;
    if (!await confirmChatGptRelaunch()) return;
    await api.launchChatGptApp({ quitRunning: true });
  };
  return {
    launchChatGpt,
    managePlugins: launchChatGpt,
    openExternal,
  };
}

async function confirmChatGptRelaunch(): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      translate('surface.platform-api.chatGPTIsAlreadyOpenAppNeedsToRelaunchItWithAppSI'),
      translate('surface.platform-api.quitAndRelaunchChatGPT'),
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('dynamic.misc.quitAndRelaunch'),
        type: 'warning',
      },
    );
    return true;
  } catch {
    return false;
  }
}

function webPlatformActions(): Readonly<AppPlatformActions> {
  return {
    launchChatGpt: () => {
      window.location.assign(CODEX_APP_DEEP_LINK);
    },
    managePlugins: () => openExternal(CHATGPT_PLUGINS_URL),
    openExternal,
  };
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
