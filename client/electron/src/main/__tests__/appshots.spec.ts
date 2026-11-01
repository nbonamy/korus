import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { captureAppshot } from '../appshots';
import type { ComputerUseOptions } from '../computer-use-tools';

const helperOptions: ComputerUseOptions = {
  appPath: `/Applications/${product.name}.app`,
  isPackaged: true,
  platform: 'darwin',
  resourcesPath: `/Applications/${product.name}.app/Contents/Resources`,
};

type FakeResponse = { ok: true; result: unknown } | { ok: false; error: string; errorCode?: string };

const oneWindow = { ok: true as const, result: { windows: [{ window_id: 7, title: 'Example', is_key: true, is_minimized: false }] } };

function fakeExecute(responses: Record<string, FakeResponse | ((args: Record<string, unknown>) => FakeResponse)>) {
  return vi.fn(async ({ command, arguments: args }: { command: string; arguments: Record<string, unknown> }) => {
    const response = responses[command];
    if (!response) throw new Error(`unexpected command ${command}`);
    return typeof response === 'function' ? response(args) : response;
  });
}

describe('captureAppshot', () => {
  it('does not load native automation when Appshots are unsupported', async () => {
    const loadNativeAutomation = vi.fn();

    await expect(captureAppshot({ loadNativeAutomation, platform: 'linux' })).rejects.toThrow(
      'Appshots are currently available only on macOS.',
    );
    expect(loadNativeAutomation).not.toHaveBeenCalled();
  });

  it('captures the identified frontmost app and includes accessibility text', async () => {
    const execute = fakeExecute({
      list_windows: oneWindow,
      screenshot: {
        ok: true,
        result: {
          app: { localizedName: 'Safari' },
          image: { dataBase64: 'cG5n', mimeType: 'image/png' },
          window: { title: 'Example' },
        },
      },
      get_app_state: { ok: true, result: { text: 'Accessibility list' } },
    });

    await expect(captureAppshot({
      computerUseOptions: helperOptions,
      execute: execute as never,
      nativeAutomation: { getForemostProcessId: () => 42 },
    })).resolves.toEqual({
      accessibilityText: 'Accessibility list',
      appName: 'Safari',
      imageDataUrl: 'data:image/png;base64,cG5n',
      windowTitle: 'Example',
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ arguments: { pid: 42 }, command: 'list_windows' }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      arguments: { pid: 42, scope: 'window', window_id: 7 },
      command: 'screenshot',
    }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      arguments: expect.objectContaining({ includeScreenshot: false, pid: 42, showCursor: false, window_id: 7 }),
      command: 'get_app_state',
    }));
  });

  it('targets the key window, then the first visible window', async () => {
    const respond = (windows: unknown[]) => fakeExecute({
      list_windows: { ok: true, result: { windows } },
      screenshot: { ok: true, result: { image: { dataBase64: 'cG5n' } } },
      get_app_state: { ok: true, result: {} },
    });
    const capture = async (windows: unknown[]) => {
      const execute = respond(windows);
      await captureAppshot({ computerUseOptions: helperOptions, execute: execute as never, nativeAutomation: { getForemostProcessId: () => 42 } });
      return execute.mock.calls.find(([call]) => call.command === 'screenshot')![0].arguments.window_id;
    };

    await expect(capture([
      { window_id: 1, is_key: false, is_minimized: false },
      { window_id: 2, is_key: true, is_minimized: false },
    ])).resolves.toBe(2);
    await expect(capture([
      { window_id: 1, is_key: false, is_minimized: true },
      { window_id: 3, is_key: false, is_minimized: false },
    ])).resolves.toBe(3);
  });

  it('fails clearly when the frontmost app has no window or windows cannot be listed', async () => {
    const options = { computerUseOptions: helperOptions, nativeAutomation: { getForemostProcessId: () => 42 } };

    await expect(captureAppshot({
      ...options,
      execute: fakeExecute({ list_windows: { ok: true, result: { windows: [] } } }) as never,
    })).rejects.toThrow('no window to capture');
    await expect(captureAppshot({
      ...options,
      execute: fakeExecute({ list_windows: { ok: false, error: 'Accessibility denied', errorCode: 'permission_denied' } }) as never,
    })).rejects.toThrow('Accessibility denied');
  });

  it('keeps the screenshot when accessibility text is unavailable', async () => {
    const execute = fakeExecute({
      list_windows: oneWindow,
      screenshot: { ok: true, result: { image: { dataBase64: 'cG5n', mimeType: 'image/png' } } },
      get_app_state: { ok: false, error: 'Accessibility denied', errorCode: 'permission_denied' },
    });

    await expect(captureAppshot({
      computerUseOptions: helperOptions,
      execute: execute as never,
      nativeAutomation: { getForemostProcessId: () => 42 },
    })).resolves.toEqual({ imageDataUrl: 'data:image/png;base64,cG5n' });
  });

  it('requests Screen Recording when capture permission is missing', async () => {
    const execute = fakeExecute({
      list_windows: oneWindow,
      request_screen_capture: { ok: true, result: {} },
      screenshot: { ok: false, error: 'Permission is missing.', errorCode: 'screen_capture_not_granted' },
      get_app_state: { ok: false, error: 'Accessibility denied', errorCode: 'permission_denied' },
    });

    await expect(captureAppshot({
      computerUseOptions: helperOptions,
      execute: execute as never,
      nativeAutomation: { getForemostProcessId: () => 42 },
    })).rejects.toThrow('Allow Screen Recording');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ command: 'request_screen_capture' }));
  });
});
