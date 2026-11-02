import { ref } from "vue";
import { sessionRequest } from "./session";

type SessionStatus =
  | "unknown"
  | "checking"
  | "authenticated"
  | "anonymous"
  | "unavailable";
export type ConsoleSession = ReturnType<typeof createConsoleSession>;
export function createConsoleSession() {
  const status = ref<SessionStatus>("unknown");
  const controller = new AbortController();
  let pending: Promise<SessionStatus> | undefined;
  return {
    status,
    authenticate() {
      status.value = "authenticated";
    },
    expire() {
      status.value = "anonymous";
    },
    dispose() {
      controller.abort();
    },
    check(force = false): Promise<SessionStatus> {
      if (pending) return pending;
      if (
        !force &&
        status.value !== "unknown" &&
        status.value !== "unavailable"
      )
        return Promise.resolve(status.value);
      status.value = "checking";
      pending = (async () => {
        try {
          const response = await sessionRequest("GET", controller.signal);
          status.value =
            response.status === 204
              ? "authenticated"
              : response.status === 401
                ? "anonymous"
                : "unavailable";
        } catch {
          status.value = "unavailable";
        } finally {
          pending = undefined;
        }
        return status.value;
      })();
      return pending;
    },
  };
}
