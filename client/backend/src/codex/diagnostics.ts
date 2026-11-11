import type { HarnessDiagnostic } from '@korus-dev/multi-agent-sdk';

/** Korus owns diagnostic opt-in and output formatting. */
export function traceCodexDiagnostic(record: HarnessDiagnostic): void {
  if (process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') {
    console.warn('[conversation-load] ' + JSON.stringify(record));
  }
}
