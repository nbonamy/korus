import path from 'node:path';
import { AppStateStore } from '../../persistence/store';
import { TelemetryConsentService } from '../consent-service';

/** Real settings persistence, including restarts and the legacy file migration. */
export async function openTelemetryConsent(home: string, options: Parameters<typeof TelemetryConsentService.open>[1] = {}) {
  const store = new AppStateStore(home);
  const snapshot = await store.load();
  return TelemetryConsentService.open({
    load: async () => store.getTelemetrySettings(),
    save: state => store.saveTelemetrySettings(snapshot, state),
  }, { legacyFile: path.join(home, 'telemetry.json'), ...options });
}
