import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { ManualUpdateCheckController } from '../manual-update-check';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('manual update checks', () => {
  it('shows the latest-version message when no update is available', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
    const controller = new ManualUpdateCheckController({
      getWindow: () => null,
      installUpdate: vi.fn(),
      showMessageBox,
    });

    expect(controller.begin({ state: 'idle' })).toBe(true);
    controller.handleStatus({ state: 'checking' });
    controller.handleStatus({ state: 'idle' });
    await flushPromises();

    expect(showMessageBox).toHaveBeenCalledWith(null, expect.objectContaining({
      message: `${product.name} is up to date`,
      type: 'info',
    }));
  });

  it('asks before installing a downloaded update', async () => {
    const installUpdate = vi.fn();
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0 });
    const controller = new ManualUpdateCheckController({
      getWindow: () => null,
      installUpdate,
      showMessageBox,
    });

    expect(controller.begin({ state: 'idle' })).toBe(true);
    controller.handleStatus({ state: 'downloaded', version: '0.4.0' });
    await flushPromises();

    expect(showMessageBox).toHaveBeenCalledWith(null, expect.objectContaining({
      buttons: ['Install and Relaunch', 'Later'],
      message: 'Update ready to install',
    }));
    expect(installUpdate).toHaveBeenCalledOnce();
  });
});
