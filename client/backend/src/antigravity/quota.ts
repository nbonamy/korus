import type { AccountRateLimitWindow, AccountRateLimits } from '@workspace/core/contracts';

/**
 * Reads the quota section of the runtime's `/usage` reply. The ACP offers it only as
 * text, so anything unfamiliar yields no windows rather than a guess.
 */
export function parseQuotaMessage(text: string): AccountRateLimits | null {
  const windows: AccountRateLimitWindow[] = [];
  let group = '';
  for (const line of text.split('\n')) {
    const heading = /^- \*\*(.+?)\*\*\s*$/u.exec(line);
    if (heading) { group = heading[1]!.replace(/\s+models$/iu, ''); continue; }
    const bucket = /^\s+- \*\*(.+?):\*\*\s*(\d+(?:\.\d+)?)%\s+remaining(?:\s+\(resets\s+(.+?)\))?\s*$/iu.exec(line);
    if (!bucket || !group) continue;
    const remaining = Math.min(100, Math.max(0, Number(bucket[2])));
    const reset = bucket[3] ? Date.parse(bucket[3]) : Number.NaN;
    windows.push({
      label: group,
      usedPercent: 100 - remaining,
      windowDurationMins: /weekly/iu.test(bucket[1]!) ? 10_080 : /daily/iu.test(bucket[1]!) ? 1_440 : null,
      resetsAt: Number.isFinite(reset) ? reset / 1000 : null,
    });
  }
  if (!windows.length) return null;
  return { limitId: null, limitName: null, primary: windows[0]!, secondary: windows[1] ?? null, credits: null, individualLimit: null, planType: null, rateLimitReachedType: null };
}
