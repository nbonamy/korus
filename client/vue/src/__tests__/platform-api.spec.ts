import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import { desktopAppHostCapabilities, webAppHostCapabilities } from '@workspace/core/client';
import type { AppApi } from '@workspace/core/contracts';
import {
  CHATGPT_PLUGINS_URL,
  CODEX_APP_DEEP_LINK,
  appClientPlatform,
  appHostCapabilities,
  appPlatformActions,
  configureAppClient,
} from '../platform-api';

describe(`${product.name} renderer platform profiles`, () => {
  afterEach(() => {
    configureAppClient(undefined);
    vi.restoreAllMocks();
  });

  it('owns the desktop profile and launches ChatGPT through the desktop API', async () => {
    const launchChatGptApp = vi.fn().mockResolvedValue({ status: 'launched' });
    configureAppClient({
      api: { launchChatGptApp } as unknown as AppApi,
      platform: 'desktop',
    });

    expect(appClientPlatform).toBe('desktop');
    expect(appHostCapabilities).toBe(desktopAppHostCapabilities);
    await appPlatformActions.launchChatGpt();
    await appPlatformActions.managePlugins();
    expect(launchChatGptApp).toHaveBeenCalledTimes(2);
  });

  it('asks before quitting and relaunching an existing ChatGPT instance', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const launchChatGptApp = vi.fn()
      .mockResolvedValueOnce({ status: 'alreadyRunning' })
      .mockResolvedValueOnce({ status: 'launched' });
    configureAppClient({
      api: { launchChatGptApp } as unknown as AppApi,
      platform: 'desktop',
    });

    await appPlatformActions.launchChatGpt();

    expect(confirm).toHaveBeenCalledWith(
      `ChatGPT is already open. ${product.name} needs to relaunch it with ${product.name}’s isolated Codex home.`,
      'Quit and relaunch ChatGPT?',
      expect.objectContaining({
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Quit and relaunch',
        type: 'warning',
      }),
    );
    expect(launchChatGptApp).toHaveBeenNthCalledWith(1);
    expect(launchChatGptApp).toHaveBeenNthCalledWith(2, { quitRunning: true });
  });

  it('leaves an existing ChatGPT instance running when relaunch is canceled', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'));
    const launchChatGptApp = vi.fn().mockResolvedValue({ status: 'alreadyRunning' });
    configureAppClient({
      api: { launchChatGptApp } as unknown as AppApi,
      platform: 'desktop',
    });

    await appPlatformActions.launchChatGpt();

    expect(launchChatGptApp).toHaveBeenCalledOnce();
    expect(launchChatGptApp).toHaveBeenCalledWith();
  });

  it('owns the web profile and opens plugin management on ChatGPT web', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    configureAppClient({ api: {} as AppApi, platform: 'web' });

    expect(appClientPlatform).toBe('web');
    expect(appHostCapabilities).toBe(webAppHostCapabilities);
    expect(appPlatformActions.launchChatGpt).toBeTypeOf('function');
    expect(CODEX_APP_DEEP_LINK).toBe('codex://');
    await appPlatformActions.managePlugins();
    expect(open).toHaveBeenCalledWith(CHATGPT_PLUGINS_URL, '_blank', 'noopener,noreferrer');
  });
});
