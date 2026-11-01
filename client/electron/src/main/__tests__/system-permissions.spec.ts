import { describe, expect, it, vi } from 'vitest';
import { getSystemPermissionsStatus, openAccessibilitySettings } from '../system-permissions';

describe('system permissions', () => {
  it('checks macOS Accessibility without prompting', () => {
    const isTrustedAccessibilityClient = vi.fn().mockReturnValue(true);

    expect(getSystemPermissionsStatus({
      platform: 'darwin',
      openExternal: vi.fn(),
      isTrustedAccessibilityClient,
    })).toStrictEqual({
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    });
    expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
  });

  it('treats Accessibility as not required outside macOS', () => {
    const isTrustedAccessibilityClient = vi.fn();

    expect(getSystemPermissionsStatus({
      platform: 'linux',
      openExternal: vi.fn(),
      isTrustedAccessibilityClient,
    })).toStrictEqual({
      platform: 'linux',
      accessibility: {
        required: false,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    });
    expect(isTrustedAccessibilityClient).not.toHaveBeenCalled();
  });

  it('opens the macOS Accessibility settings pane with fallbacks', async () => {
    const openExternal = vi.fn()
      .mockRejectedValueOnce(new Error('old url failed'))
      .mockResolvedValueOnce(undefined);
    const isTrustedAccessibilityClient = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    await expect(openAccessibilitySettings({
      platform: 'darwin',
      openExternal,
      isTrustedAccessibilityClient,
    })).resolves.toStrictEqual({
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: false,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    });
    expect(isTrustedAccessibilityClient).toHaveBeenNthCalledWith(1, true);
    expect(isTrustedAccessibilityClient).toHaveBeenNthCalledWith(2, false);
    expect(openExternal).toHaveBeenNthCalledWith(1, 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    expect(openExternal).toHaveBeenNthCalledWith(2, 'x-apple.systempreferences:com.apple.preference.security?Privacy');
  });

  it('skips opening settings when the native Accessibility prompt grants trust', async () => {
    const openExternal = vi.fn();
    const isTrustedAccessibilityClient = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);

    await expect(openAccessibilitySettings({
      platform: 'darwin',
      openExternal,
      isTrustedAccessibilityClient,
    })).resolves.toStrictEqual({
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
