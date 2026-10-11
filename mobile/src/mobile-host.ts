import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export type MobileHost = {
  platform: string;
  onResume(listener: () => void): Promise<() => void>;
};

/** Native affordances stay here; the shared Vue shell never imports a platform plugin. */
export function createMobileHost(): MobileHost {
  const platform = Capacitor.getPlatform();
  return {
    platform,
    async onResume(listener) {
      if (platform === 'web') return () => {};
      const handle = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) listener(); });
      return () => { void handle.remove(); };
    },
  };
}
