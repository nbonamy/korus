import type { HarnessDiagnostic } from 'multi-agents-sdk/diagnostics';

/** Korus owns diagnostic opt-in and output formatting. */
export function traceCodexDiagnostic(record: HarnessDiagnostic): void {
  if (process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') {
    console.warn('[conversation-load] ' + JSON.stringify(record));
  }
}
