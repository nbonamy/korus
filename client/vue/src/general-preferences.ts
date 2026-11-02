import { inject, type InjectionKey } from 'vue';
import type { AppGeneralSettings, UpdateGeneralSettingsInput } from '@workspace/core/contracts';
import { normalizeGeneralSettings } from '@workspace/core/settings';

type PreferenceChange = UpdateGeneralSettingsInput | ((general: AppGeneralSettings) => UpdateGeneralSettingsInput);
export type GeneralPreferences = {
  general: () => AppGeneralSettings;
  update: (change: PreferenceChange) => Promise<void>;
  migrate: () => Promise<void>;
};
export const generalPreferencesKey: InjectionKey<GeneralPreferences> = Symbol('generalPreferences');
// TODO(2026-12-02): Remove all three legacy migrations and their localStorage fallback reads.
const legacyKeys = {
  githubStarPrompt: 'app:githubStarPrompt:v1',
  preferredProviders: 'app:preferredEngines',
  gitMergeCleanup: 'app:mergeCleanup',
} as const;
type LegacyField = keyof typeof legacyKeys;
const fields = Object.keys(legacyKeys) as LegacyField[];

function readLegacy(field: LegacyField) {
  try {
    const raw = localStorage.getItem(legacyKeys[field]);
    if (raw === null) return undefined;
    return { raw, value: normalizeGeneralSettings({ [field]: JSON.parse(raw) })[field] };
  } catch { return undefined; }
}

// Serialize edits across the app's readers. Compute each edit from fresh state,
// so concurrent prompt counts and per-host choices cannot replace pending writes.
let pending: Promise<void> = Promise.resolve();
export function createGeneralPreferences(stored: () => AppGeneralSettings, save: (input: UpdateGeneralSettingsInput) => Promise<void>): GeneralPreferences {
  const general = (): AppGeneralSettings => {
    const current = { ...stored() };
    // If persistence fails, continue using the legacy preference until a save
    // succeeds. A new prompt must not reset a previously dismissed reminder.
    for (const field of fields) {
      if (current[field] === undefined) Object.assign(current, { [field]: readLegacy(field)?.value });
    }
    return current;
  };
  const preferences: GeneralPreferences = {
    general,
    update(change) {
      const next = pending.catch(() => undefined).then(async () => {
        const legacy = Object.fromEntries(fields.map(field => [field, readLegacy(field)]));
        const input = typeof change === 'function' ? change(general()) : change;
        if (!Object.keys(input).length) return;
        await save(input);
        for (const field of fields) {
          // A successful RPC alone is insufficient: an older host may drop new
          // fields. Preserve values changed by another renderer while saving.
          if (input[field] !== undefined && stored()[field] !== undefined && legacy[field]
            && localStorage.getItem(legacyKeys[field]) === legacy[field].raw) {
            localStorage.removeItem(legacyKeys[field]);
          }
        }
      });
      pending = next;
      return next;
    },
    async migrate() {
      for (const field of fields) {
        try {
          const raw = localStorage.getItem(legacyKeys[field]);
          if (raw === null) continue;
          if (stored()[field] === undefined) {
            if (readLegacy(field)?.value === undefined) continue;
            await preferences.update(current => stored()[field] === undefined ? { [field]: current[field] } : {});
          }
          if (stored()[field] !== undefined && localStorage.getItem(legacyKeys[field]) === raw) localStorage.removeItem(legacyKeys[field]);
        } catch { /* Retry on the next load without blocking the app. */ }
      }
    },
  };
  return preferences;
}

export function useGeneralPreferences(): GeneralPreferences | undefined {
  return inject(generalPreferencesKey, undefined);
}
