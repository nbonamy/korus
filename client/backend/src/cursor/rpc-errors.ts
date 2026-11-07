import { AcpError } from '../acp/acp-connection';

const teamSwitched = 'Your team has switched. Reconnect Cursor in Settings.';
const policyDenied = 'Cursor ACP is blocked by your team policy. Contact your administrator.';
const authenticationRequired = 'Cursor authentication is required. Reconnect Cursor in Settings.';
const quotaExhausted = 'Cursor usage limit reached. Check your Cursor plan or usage in Cursor.';

// Match explicit exhaustion statements, not congestion, rate throttling or quoted
// model/account diagnostics. Unknown native wording stays an ordinary RPC error.
const quotaStatements = [
  /^(?:your\s+)?(?:quota|usage[ -]+limit|(?:included|monthly)\s+(?:usage\s+)?allowance|credits?|credit\s+balance)\s+(?:has\s+(?:been\s+)?|is\s+)?(?:exceeded|exhausted|depleted|reached)\b/i,
  /^you(?:'ve| have)?\s+(?:hit|reached|exhausted|exceeded)\s+(?:your\s+|the\s+)?(?:monthly\s+|included\s+|free\s+)?(?:quota|usage[ -]+limit|credits)\b/i,
  /^(?:insufficient\s+credits|out of\s+credits|no\s+(?:remaining|available)\s+credits|no\s+credits\s+(?:remaining|available))\b/i,
];

export function cursorRpcErrorMessage(code: number, message: unknown): string {
  if (typeof message === 'string' && /your team has switched/i.test(message)) return teamSwitched;
  if (typeof message === 'string' && /(?:headless|acp).*(?:disabled|blocked|not allowed|policy)/i.test(message)) return policyDenied;
  // ACP authentication-required is authoritative even when its text mentions usage.
  if (code === -32000) return authenticationRequired;
  if (typeof message === 'string') {
    const statement = message.trim().replace(/^error:\s*/i, '').replace(/^\[resource_exhausted\]\s*/i, '');
    if (quotaStatements.some(pattern => pattern.test(statement))) return quotaExhausted;
  }
  return `Cursor ACP request failed (${code}). Try again in this conversation.`;
}

export function isCursorAuthenticationFailure(error: Error): boolean {
  return error instanceof AcpError && error.code === -32000 ||
    [teamSwitched, policyDenied, authenticationRequired].includes(error.message);
}

export function isCursorQuotaFailure(error: Error): boolean {
  return !(error instanceof AcpError && error.code === -32000) && error.message === quotaExhausted;
}
