import { ref, type InjectionKey, type Ref } from "vue";
import type { AppApi } from "@workspace/core/contracts";
import type {
  TelemetryConsentAction,
  TelemetryConsentView,
} from "@workspace/core/telemetry-consent";
import { appApi } from "../platform-api";

export const telemetryNoticeReadyKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol("telemetryNoticeReady");

// Only the dedicated desktop surfaces share this private view, never app-state.
const stores = new WeakMap<AppApi, ReturnType<typeof createStore>>();
function createStore(api: AppApi) {
  const state = ref<TelemetryConsentView | null>(null);
  const busy = ref(false);
  const failed = ref(false);
  let revision = 0;
  let failedAction: TelemetryConsentAction | null = null;
  async function load() {
    if (busy.value) return;
    const expected = ++revision;
    try {
      const next = await api.getTelemetryConsent();
      if (expected === revision) {
        state.value = next;
        failed.value = false;
      }
    } catch {
      if (expected === revision) failed.value = true;
    }
  }
  async function change(action: TelemetryConsentAction): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true;
    failed.value = false;
    ++revision;
    try {
      const next = await api.changeTelemetryConsent(action);
      ++revision;
      state.value = next;
      failedAction = null;
      return true;
    } catch {
      // Persistence can succeed even when the delivery owner's cancellation fails.
      // Reconcile authority while keeping the failed action visible.
      try {
        state.value = await api.getTelemetryConsent();
      } catch {
        /* retain last view */
      }
      ++revision;
      failedAction = action;
      failed.value = true;
      return false;
    } finally {
      busy.value = false;
    }
  }
  async function retry() {
    if (failedAction) await change(failedAction);
    else await load();
  }
  return { state, busy, failed, load, change, retry };
}
export function useTelemetryConsent() {
  if (!appApi) throw new Error("Desktop settings unavailable.");
  let store = stores.get(appApi);
  if (!store) {
    store = createStore(appApi);
    stores.set(appApi, store);
  }
  return store;
}
