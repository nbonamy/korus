import type { ClientFeature, FeatureOutcome } from "@workspace/core/telemetry";
import { backendMethods } from "@workspace/core/backend-protocol/methods";

type BackendPort = { request<T>(method: string, params?: unknown): Promise<T> };
/** Native completions feed the daemon's existing consent-bound, typed reporter. */
export async function observeUsageFeature<T>(
  backend: BackendPort | null,
  feature: ClientFeature,
  execute: () => Promise<T>,
): Promise<T> {
  let id: string | null = null;
  try {
    id =
      (await backend?.request<string | null>(
        backendMethods.telemetryFeatureBegin,
        { feature },
      )) ?? null;
  } catch {
    /* Observation cannot prevent an operation. */
  }
  async function finish(
    outcome: Exclude<FeatureOutcome, "attempted">,
  ): Promise<void> {
    if (!id) return;
    try {
      await backend?.request(backendMethods.telemetryFeatureFinish, {
        operationId: id,
        outcome,
      });
    } catch {
      /* No telemetry error content is logged. */
    }
  }
  try {
    const result = await execute();
    await finish("succeeded");
    return result;
  } catch (error) {
    await finish("failed");
    throw error;
  }
}

export type SpeechOperationObserver = (
  operation: "start" | "stop" | "cancel",
) => ((outcome: "succeeded" | "failed" | "cancelled") => void) | void;
/** Paired SDK observer is synchronous: dictation never waits for telemetry or supplies content. */
export function speechOperationObserver(
  backend: () => BackendPort | null,
  permission: () => number | null,
): SpeechOperationObserver {
  return (operation) => {
    const epoch = permission();
    if (epoch === null) return;
    const feature =
      operation === "start"
        ? "dictation.start"
        : operation === "stop"
          ? "dictation.stop"
          : "dictation.cancel";
    const id =
      backend()
        ?.request<string | null>(backendMethods.telemetryFeatureBegin, {
          feature,
        })
        .catch(() => null) ?? Promise.resolve(null);
    let finished = false;
    return (outcome) => {
      if (finished) return;
      finished = true;
      void id
        .then((operationId) => {
          if (!operationId || permission() !== epoch) return;
          return backend()?.request(backendMethods.telemetryFeatureFinish, {
            operationId,
            outcome,
          });
        })
        .catch(() => undefined);
    };
  };
}

/** Named viewport/capture commands only; page interactions and arguments are never observed. */
export function observeBrowserCommand<T>(
  backend: BackendPort | null,
  command: string,
  execute: () => Promise<T>,
): Promise<T> {
  const feature =
    command === "viewport"
      ? "browser.responsive"
      : command === "screenshot"
        ? "browser.capture"
        : null;
  return feature ? observeUsageFeature(backend, feature, execute) : execute();
}
