import { inject, type InjectionKey } from 'vue';
import type { AppGeneralSettings, UpdateGeneralSettingsInput } from '@workspace/core/contracts';

type PreferenceChange = UpdateGeneralSettingsInput | ((general: AppGeneralSettings) => UpdateGeneralSettingsInput);
export type GeneralPreferences = {
  general: () => AppGeneralSettings;
  update: (change: PreferenceChange) => Promise<void>;
};
export const generalPreferencesKey: InjectionKey<GeneralPreferences> = Symbol('generalPreferences');

// Serialize edits across the app's readers. Compute each edit from fresh state,
// so concurrent prompt counts and per-host choices cannot replace pending writes.
let pending: Promise<void> = Promise.resolve();
export function createGeneralPreferences(stored: () => AppGeneralSettings, save: (input: UpdateGeneralSettingsInput) => Promise<void>): GeneralPreferences {
  const general = () => ({ ...stored() });
  return {
    general,
    update(change) {
      const next = pending.catch(() => undefined).then(() => {
        const input = typeof change === 'function' ? change(general()) : change;
        if (Object.keys(input).length) return save(input);
      });
      pending = next;
      return next;
    },
  };
}

export function useGeneralPreferences(): GeneralPreferences | undefined {
  return inject(generalPreferencesKey, undefined);
}
