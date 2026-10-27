import type { UsageSummary } from '@workspace/core/usage';

export type AgentCost = {
  /** Estimated at API prices; null when nothing could be priced. */
  usd: number | null;
  coverage: 'complete' | 'partial' | 'unavailable';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number | null;
  cacheReadTokens: number;
  turns: number;
};

/** Adds up what the ledger recorded for these agents (rows grouped by agent). Null when there is nothing to show. */
export function agentCostFor(summary: UsageSummary | null, agentIds: readonly string[]): AgentCost | null {
  if (!summary || summary.available === false) return null;
  const wanted = new Set(agentIds);
  const rows = summary.rows.filter(row => wanted.has(row.label));
  if (rows.length === 0) return null;
  let usd: number | null = null;
  let complete = true;
  const total: AgentCost = { usd: null, coverage: 'unavailable', inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, turns: 0 };
  for (const row of rows) {
    if (row.cost?.usd !== null && row.cost?.usd !== undefined) usd = (usd ?? 0) + row.cost.usd;
    if (row.cost?.coverage !== 'complete') complete = false;
    total.inputTokens += row.tokens?.input ?? 0;
    total.outputTokens += row.tokens?.output ?? 0;
    total.totalTokens = total.totalTokens === null || row.tokens?.total == null ? null : total.totalTokens + row.tokens.total;
    total.cacheReadTokens += row.tokens?.cacheRead ?? 0;
    total.turns += row.started;
  }
  total.usd = usd;
  total.coverage = usd === null ? 'unavailable' : complete ? 'complete' : 'partial';
  return total;
}
