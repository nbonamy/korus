import { onMounted, onUnmounted, ref } from "vue";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { currentDay, utcDay, viewerTimeZone } from "./format";

export function useMetrics(
  onSessionExpired?: () => void,
  weekly: () => boolean = () => false,
) {
  const timeZone = viewerTimeZone();
  const to = ref(currentDay(timeZone));
  const from = ref(utcDay(Date.parse(to.value) - 29 * 86400000));
  const provider = ref(""),
    model = ref("");
  const groupServiceTiers = ref(false);
  const availableModels = ref<string[]>([]);
  const availableProviders = ref<string[]>([]);
  const data = ref<TelemetryMetrics | null>(null),
    previousData = ref<TelemetryMetrics | null>(null),
    loading = ref(false),
    error = ref("");
  let request = 0,
    controller: AbortController | undefined;
  async function load() {
    const identity = ++request;
    controller?.abort();
    data.value = null;
    previousData.value = null;
    error.value = "";
    const validDay = (day: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      Number.isFinite(Date.parse(day)) &&
      utcDay(Date.parse(day)) === day;
    const isWeekly = weekly();
    const queryTo = isWeekly ? currentDay(timeZone) : to.value;
    const queryFrom = isWeekly
      ? utcDay(Date.parse(queryTo) - 13 * 86400000)
      : from.value;
    const span = (Date.parse(queryTo) - Date.parse(queryFrom)) / 86400000;
    if (
      !validDay(queryFrom) ||
      !validDay(queryTo) ||
      span < 0 ||
      span > 3659 ||
      queryTo > currentDay(timeZone)
    ) {
      error.value = "Choose days in order, up to 3,660 days per range.";
      loading.value = false;
      return;
    }
    const params = new URLSearchParams({
      from: queryFrom,
      to: queryTo,
      timeZone,
    });
    if (!isWeekly && provider.value) params.set("provider", provider.value);
    if (!isWeekly && model.value) params.set("model", model.value);
    if (!isWeekly && groupServiceTiers.value)
      params.set("groupServiceTiers", "true");
    const active = (controller = new AbortController());
    loading.value = true;
    const timeout = setTimeout(() => active.abort(), 15000);
    try {
      // The console proxy owns viewer authentication and the private upstream
      // token. The HttpOnly session is sent only to the same origin.
      const read = async (query: URLSearchParams) => {
        const response = await fetch(`/v1/telemetry/metrics?${query}`, {
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
        return (await response.json()) as TelemetryMetrics;
      };
      const previousParams = new URLSearchParams(params);
      previousParams.set("to", utcDay(Date.parse(queryTo) - 7 * 86400000));
      previousParams.set("from", queryFrom);
      const [result, previous] = await Promise.all([
        read(params),
        isWeekly ? read(previousParams) : Promise.resolve(null),
      ]);
      if (identity === request) {
        availableProviders.value = result.availableProviders ?? [...new Set(result.models.map(row=>row.provider))].sort();
        availableModels.value =
          result.availableModels ??
          [
            ...new Set(
              result.models
                .filter(
                  (row) =>
                    row.turns !== "0" ||
                    (row.totalTokens !== null && row.totalTokens !== "0"),
                )
                .map((row) => row.model),
            ),
          ].sort();
        if (
          !isWeekly &&
          model.value &&
          !availableModels.value.includes(model.value)
        ) {
          model.value = "";
          await load();
        } else {
          data.value = result;
          previousData.value = previous;
        }
      }
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
    to.value = currentDay(timeZone);
    from.value = utcDay(Date.parse(to.value) - (days - 1) * 86400000);
    void load();
  }
  onMounted(load);
  onUnmounted(() => {
    request++;
    controller?.abort();
  });
  return {
    timeZone,
    from,
    to,
    provider,
    model,
    availableModels,
    availableProviders,
    groupServiceTiers,
    data,
    previousData,
    loading,
    error,
    load,
    recent,
  };
}
