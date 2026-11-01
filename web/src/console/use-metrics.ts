import { onMounted, onUnmounted, ref } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { completedDay, utcDay } from "./format";

export function useMetrics(onSessionExpired?: () => void) {
  const to = ref(completedDay());
  const from = ref(utcDay(Date.parse(to.value) - 29 * 86400000));
  const provider = ref(""),
    model = ref("");
  const groupServiceTiers = ref(false);
  const data = ref<TelemetryMetrics | null>(null),
    loading = ref(false),
    error = ref("");
  let request = 0,
    controller: AbortController | undefined;
  async function load() {
    const identity = ++request;
    controller?.abort();
    data.value = null;
    error.value = "";
    const validDay = (day: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      Number.isFinite(Date.parse(day)) &&
      utcDay(Date.parse(day)) === day;
    const span = (Date.parse(to.value) - Date.parse(from.value)) / 86400000;
    if (
      !validDay(from.value) ||
      !validDay(to.value) ||
      span < 0 ||
      span > 3659 ||
      to.value > completedDay()
    ) {
      error.value =
        "Choose completed UTC days in order, up to 3,660 days per range.";
      loading.value = false;
      return;
    }
    const params = new URLSearchParams({ from: from.value, to: to.value });
    if (provider.value) params.set("provider", provider.value);
    if (model.value) params.set("model", model.value);
    if (groupServiceTiers.value) params.set("groupServiceTiers", "true");
    const active = (controller = new AbortController());
    loading.value = true;
    const timeout = setTimeout(() => active.abort(), 15000);
    try {
      // The console proxy owns viewer authentication and the private upstream
      // token. The HttpOnly session is sent only to the same origin.
      const response = await fetch(`/v1/telemetry/metrics?${params}`, {
        signal: active.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 401 && identity === request)
          onSessionExpired?.();
        if (response.status === 401 || response.status === 403)
          throw new Error(
            "Private access required. Sign in through the console access gate, then refresh.",
          );
        if (response.status === 400)
          throw new Error(
            "This range or filter is not available. Check the selection and try again.",
          );
        throw new Error(
          "Metrics are temporarily unavailable. Refresh to try again.",
        );
      }
      const result = (await response.json()) as TelemetryMetrics;
      if (identity === request) data.value = result;
    } catch (cause) {
      if (identity === request)
        error.value =
          cause instanceof Error && cause.message.startsWith("Private access")
            ? cause.message
            : cause instanceof Error && cause.message.startsWith("This range")
              ? cause.message
              : "Metrics are temporarily unavailable. Refresh to try again.";
    } finally {
      clearTimeout(timeout);
      if (identity === request) loading.value = false;
    }
  }
  function recent(days: number) {
    to.value = completedDay();
    from.value = utcDay(Date.parse(to.value) - (days - 1) * 86400000);
    void load();
  }
  onMounted(load);
  onUnmounted(() => {
    request++;
    controller?.abort();
  });
  return {
    from,
    to,
    provider,
    model,
    groupServiceTiers,
    data,
    loading,
    error,
    load,
    recent,
  };
}
