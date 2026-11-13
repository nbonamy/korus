import type { HarnessProvider } from '../contracts';

export type ProviderUpdateStatus = {
  provider: HarnessProvider;
  status: 'unavailable' | 'manual' | 'current' | 'available' | 'waiting' | 'upgrading' | 'error';
  installedVersion?: string;
  latestVersion?: string;
  method: 'native' | 'npm' | 'homebrew' | 'manual';
  channel?: string;
  canUpgrade: boolean;
  busy: boolean;
  token?: string;
  error?: 'checkFailed' | 'installationChanged' | 'upgradeFailed' | 'verificationFailed';
};

export type ProviderUpdateInput =
  | { action: 'upgrade'; confirmed: boolean; token?: string }
  | { action: 'cancel' };
