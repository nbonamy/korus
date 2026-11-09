import { validConsumption, type Consumption } from '@workspace/core/usage';
import { record } from '../acp/acp-connection';

/** ACP's disjoint input/cache buckets become the ledger's inclusive input count. */
function consumption(value: unknown): Consumption | null {
  if (!record(value)) return null;
  const integer = (key: string) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= 1e9;
  // Missing cache evidence is unknown, not a reported zero.
  if (!['totalTokens', 'inputTokens', 'outputTokens', 'cachedReadTokens'].every(integer)
    || (value.cachedWriteTokens != null && !integer('cachedWriteTokens'))
    || (value.thoughtTokens != null && !integer('thoughtTokens'))) return null;
  const cacheWrite = value.cachedWriteTokens == null ? null : value.cachedWriteTokens as number;
  const input = (value.inputTokens as number) + (value.cachedReadTokens as number) + (cacheWrite ?? 0);
  const tokens: Consumption = { total: value.totalTokens as number, input, output: value.outputTokens as number,
    cacheRead: value.cachedReadTokens as number, cacheWrite, reasoning: value.thoughtTokens == null ? null : value.thoughtTokens as number };
  return tokens.total === input + tokens.output && validConsumption(tokens) ? tokens : null;
}

/** Cumulative ACP session counters; never use context occupancy as consumption. */
export class CursorUsageCounter {
  private previous: Consumption | null;
  constructor(resumed: boolean) {
    // A cold history load has no trustworthy start counter. Prime it without charging history.
    this.previous = resumed ? null : { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  }
  invalidate(): void { this.previous = null; }
  finish(value: unknown): Consumption | null {
    const previous = this.previous;
    const current = consumption(value);
    this.previous = current;
    if (!previous || !current) return null;
    const optional = (key: 'cacheWrite' | 'reasoning') => current[key] == null || previous[key] == null ? null : current[key]! - previous[key]!;
    const delta: Consumption = { total: current.total! - previous.total!, input: current.input - previous.input,
      output: current.output - previous.output, cacheRead: current.cacheRead - previous.cacheRead,
      cacheWrite: optional('cacheWrite'), reasoning: optional('reasoning') };
    // Decreasing or inconsistent counters establish a new baseline, never negative or clamped usage.
    return validConsumption(delta) && delta.input >= delta.cacheRead + (delta.cacheWrite ?? 0) ? delta : null;
  }
}
