import type { ComponentLogger, Logger } from '@libp2p/interface';

/** Local connection metadata only: never pass request arguments, payloads or error messages. */
type Details = {
  streamId?: string; requestId?: string; method?: string; reason?: string; stage?: string;
  elapsedMs?: number; idleMs?: number; pending?: number; sequence?: number;
  oldestMethod?: string; oldestAgeMs?: number; agentId?: string;
  errorName?: string; errorCode?: string; reused?: boolean; connectionCount?: number;
  connectionId?: string; remainingBytes?: string; remainingSeconds?: number;
  closeCode?: number; wasClean?: boolean;
};
export type ConnectionDiagnostic = Details & { event: string; at: string };
let sink: ((record: ConnectionDiagnostic) => void | Promise<void>) | undefined;
export function setConnectionDiagnosticSink(next: typeof sink) { sink = next; }
export function connectionDiagnostic(event: string, details: Details = {}) {
  try { void Promise.resolve(sink?.({ ...details, event, at: new Date().toISOString() })).catch(() => {}); }
  catch { /* Diagnostics must never change connection behavior. */ }
}
export function connectionError(error: unknown): Pick<Details, 'errorName' | 'errorCode'> {
  const safe = (value: unknown) => typeof value === 'string' && /^[\w.-]{1,64}$/.test(value) ? value : undefined;
  // libp2p exposes relay refusal codes only in this fixed, payload-free error format.
  const relayStatus = error instanceof Error && error.name === 'InvalidMessageError'
    ? /^failed to connect via relay with status ([A-Z_]{1,40}|\d{1,3}|undefined)$/.exec(error.message)?.[1] : undefined;
  return { errorName: error instanceof Error ? safe(error.name) : undefined,
    errorCode: (error && typeof error === 'object' && 'code' in error ? safe(error.code) : undefined) ?? (relayStatus ? `RELAY_${relayStatus}` : undefined) };
}

/** Translate only these dependency diagnostics; raw log arguments can contain private data. */
export const connectionLogger: ComponentLogger = {
  forComponent(name) {
    const monitor = name === 'libp2p:connection-monitor';
    const socket = name.startsWith('libp2p:websockets:connection');
    const log = (format: unknown, ...args: unknown[]) => {
      if (socket && format === 'closed - code %d, reason "%s", wasClean %s') {
        connectionDiagnostic('transport.socket-close', {
          closeCode: typeof args[0] === 'number' ? args[0] : undefined,
          wasClean: typeof args[2] === 'boolean' ? args[2] : undefined,
        });
      } else if (monitor && format === 'error during heartbeat - %e') {
        connectionDiagnostic('transport.heartbeat-error', connectionError(args[0]));
      } else if (monitor && format === 'aborting connection due to ping failure') {
        connectionDiagnostic('transport.heartbeat-abort');
      }
    };
    return Object.assign(log, {
      error: log, trace: () => {}, enabled: monitor || socket,
      newScope: (scope: string): Logger => connectionLogger.forComponent(`${name}:${scope}`),
    });
  },
};
