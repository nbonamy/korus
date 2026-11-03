import { backendRequestTimeoutMs as operationTimeoutMs } from '@workspace/core/backend-protocol/request-timeout';

// Allow the remote hop to return its own timeout before the desktop gives up.
export function backendRequestTimeoutMs(method: string, params?: unknown): number | null {
  const timeout = operationTimeoutMs(method, params);
  return timeout === null ? null : timeout + 5_000;
}
