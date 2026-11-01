import { shell, systemPreferences } from 'electron';
import type { SystemPermissionsStatus } from '@workspace/core/contracts';

type SystemPermissionDependencies = {
  openExternal: (url: string) => Promise<unknown>;
  platform: string;
  isTrustedAccessibilityClient: (prompt: boolean) => boolean;
};

const accessibilitySettingsUrls = [
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'x-apple.systempreferences:com.apple.preference.security?Privacy',
  'x-apple.systempreferences:',
];

function defaultDependencies(): SystemPermissionDependencies {
  return {
    openExternal: (url) => shell.openExternal(url),
    platform: process.platform,
    isTrustedAccessibilityClient: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
  };
}

export function getSystemPermissionsStatus(
  dependencies: SystemPermissionDependencies = defaultDependencies(),
): SystemPermissionsStatus {
  if (dependencies.platform !== 'darwin') {
    return {
      platform: dependencies.platform,
      accessibility: {
        required: false,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    };
  }

  return {
    platform: dependencies.platform,
    accessibility: {
      required: true,
      trusted: dependencies.isTrustedAccessibilityClient(false),
    },
    screenRecording: {
      required: false,
      trusted: true,
    },
  };
}

export async function openAccessibilitySettings(
  dependencies: SystemPermissionDependencies = defaultDependencies(),
): Promise<SystemPermissionsStatus> {
  if (dependencies.platform === 'darwin') {
    const trusted = dependencies.isTrustedAccessibilityClient(true);
    if (!trusted) {
      await openFirstAvailableSettingsUrl(dependencies);
    }
  }

  return getSystemPermissionsStatus(dependencies);
}

async function openFirstAvailableSettingsUrl(dependencies: SystemPermissionDependencies): Promise<void> {
  let lastError: unknown;
  for (const url of accessibilitySettingsUrls) {
    try {
      await dependencies.openExternal(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to open macOS Accessibility settings.');
}
