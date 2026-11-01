import { product } from '@workspace/core/product';
import { app } from 'electron';
import type { Autolib } from 'autolib';
import { executeComputerUseCommand, type ComputerUseOptions } from './computer-use-tools';
import { loadNativeAutomation } from './native-automation';

export type AppshotCapture = {
  accessibilityText?: string;
  appName?: string;
  imageDataUrl: string;
  windowTitle?: string;
};

export type CaptureAppshotOptions = {
  computerUseOptions?: ComputerUseOptions;
  execute?: typeof executeComputerUseCommand;
  loadNativeAutomation?: typeof loadNativeAutomation;
  nativeAutomation?: Pick<Autolib, 'getForemostProcessId'>;
  platform?: NodeJS.Platform;
};

export async function captureAppshot(options: CaptureAppshotOptions = {}): Promise<AppshotCapture> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && !options.computerUseOptions) {
    throw new Error('Appshots are currently available only on macOS.');
  }
  const nativeAutomation = options.nativeAutomation
    ?? (options.loadNativeAutomation ?? loadNativeAutomation)();
  const pid = nativeAutomation.getForemostProcessId();
  if (!pid) throw new Error('The frontmost application could not be identified.');

  const execute = options.execute ?? executeComputerUseCommand;
  const helperOptions = options.computerUseOptions ?? {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    platform,
    resourcesPath: process.resourcesPath,
  };
  // The helper requires an explicit window target for window-scoped commands.
  const windows = await execute({ command: 'list_windows', arguments: { pid }, options: helperOptions });
  if (!windows.ok) throw new Error(windows.error);
  const windowId = frontmostWindowId(record(windows.result)?.windows);
  if (windowId === undefined) throw new Error('The frontmost application has no window to capture.');

  const [screenshot, accessibility] = await Promise.all([
    execute({ command: 'screenshot', arguments: { pid, scope: 'window', window_id: windowId }, options: helperOptions }),
    execute({
      command: 'get_app_state',
      arguments: { pid, window_id: windowId, includeScreenshot: false, maxDepth: 16, maxNodes: 3_000, maxTextCharacters: 30_000, showCursor: false },
      options: helperOptions,
    }),
  ]);

  if (!screenshot.ok) {
    if (
      screenshot.errorCode === 'permission_denied'
      || screenshot.errorCode === 'screen_capture_not_granted'
      || screenshot.error.includes('Screen Recording')
    ) {
      await execute({ command: 'request_screen_capture', arguments: {}, options: helperOptions });
      throw new Error(`Allow Screen Recording for ${product.name} Computer Use, then try the Appshot again.`);
    }
    throw new Error(screenshot.error);
  }

  const screenshotResult = record(screenshot.result);
  const image = record(screenshotResult?.image);
  const dataBase64 = stringValue(image?.dataBase64);
  if (!dataBase64) throw new Error('The frontmost window screenshot was empty.');
  const appResult = record(screenshotResult?.app);
  const windowResult = record(screenshotResult?.window);
  const accessibilityResult = accessibility.ok ? record(accessibility.result) : null;

  return {
    imageDataUrl: `data:${stringValue(image?.mimeType) ?? 'image/png'};base64,${dataBase64}`,
    ...(stringValue(accessibilityResult?.text) ? { accessibilityText: stringValue(accessibilityResult?.text) } : {}),
    ...(stringValue(appResult?.localizedName) ? { appName: stringValue(appResult?.localizedName) } : {}),
    ...(stringValue(windowResult?.title) ? { windowTitle: stringValue(windowResult?.title) } : {}),
  };
}

function frontmostWindowId(windows: unknown): number | undefined {
  const candidates = (Array.isArray(windows) ? windows : [])
    .map(record)
    .filter((window): window is Record<string, unknown> => typeof window?.window_id === 'number');
  const target = candidates.find((window) => window.is_key === true)
    ?? candidates.find((window) => window.is_minimized !== true)
    ?? candidates[0];
  return target?.window_id as number | undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
