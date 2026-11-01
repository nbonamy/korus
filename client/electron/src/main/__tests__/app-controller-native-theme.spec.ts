import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppSnapshot, AppearanceMode, UpdateSettingsInput } from '@workspace/core/contracts';

const host = vi.hoisted(() => ({ nativeTheme: { themeSource: 'system' as AppearanceMode } }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/test/app' },
  nativeTheme: host.nativeTheme,
  powerMonitor: { on: vi.fn(), removeListener: vi.fn(), isOnBatteryPower: () => false },
}));

import { AppController } from '../app-controller';
import { createBackendClient, updateSettings } from './app-controller-test-harness';

function snapshotWithMode(mode: AppearanceMode): AppSnapshot {
  const snapshot = createInitialSnapshot();
  return { ...snapshot, theme: { ...snapshot.theme, mode } };
}

describe('AppController native appearance', () => {
  it('forces the OS-drawn window chrome to the chosen appearance and releases it for system mode', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(snapshotWithMode('light'))
      .mockResolvedValueOnce(snapshotWithMode('system'));
    const controller = new AppController(snapshotWithMode('dark'), createBackendClient({ request }));
    const input = { theme: { mode: 'light' } } as unknown as UpdateSettingsInput;

    await controller.initialize();
    expect(host.nativeTheme.themeSource).toBe('dark');

    await updateSettings(controller, input);
    expect(host.nativeTheme.themeSource).toBe('light');

    await updateSettings(controller, input);
    expect(host.nativeTheme.themeSource).toBe('system');
  });
});
