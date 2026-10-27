import { describe, expect, it } from 'vitest';
import type { UsageCost, UsageSummary } from '@workspace/core/usage';
import { agentCostFor, cachedShare, formatCost } from '../agent-cost';

const cost = (usd: number | null, coverage: UsageCost['coverage'] = 'complete'): UsageCost => ({ usd, coverage, requests: 1, pricedRequests: usd === null ? 0 : 1, unpricedRequests: usd === null ? 1 : 0, unknownRequestExecutions: 0, reasons: [] });
const row = (label: string, input: number, cacheRead: number, output: number, rowCost?: UsageCost): UsageSummary['rows'][number] => ({
  label, started: 2, completed: 2, failed: 0, interrupted: 0, inProgress: 0, measuredTurns: 2,
  tokens: { input, output, cacheRead, cacheWrite: null }, ...(rowCost ? { cost: rowCost } : {}),
});
const summary = (rows: UsageSummary['rows']): UsageSummary => ({ rows, recordedSince: 0, retainedSince: 0 });

describe('agentCostFor', () => {
  it('adds up the rows of the requested agents and ignores the others', () => {
    const total = agentCostFor(summary([row('a', 1000, 900, 100, cost(1.25)), row('b', 500, 0, 50, cost(0.5)), row('other', 9999, 0, 9, cost(99))]), ['a', 'b']);
    expect(total).toStrictEqual({ usd: 1.75, coverage: 'complete', inputTokens: 1500, outputTokens: 150, cacheReadTokens: 900, turns: 4 });
  });

  it('is null when none of the agents has recorded usage, and when usage is unavailable', () => {
    expect(agentCostFor(summary([row('other', 1, 0, 1, cost(1))]), ['a'])).toBeNull();
    expect(agentCostFor(null, ['a'])).toBeNull();
    expect(agentCostFor({ ...summary([]), available: false }, ['a'])).toBeNull();
  });

  it('reports partial coverage when some usage could not be priced, and unavailable when none could', () => {
    expect(agentCostFor(summary([row('a', 10, 0, 1, cost(1)), row('b', 10, 0, 1, cost(null, 'unavailable'))]), ['a', 'b'])).toMatchObject({ usd: 1, coverage: 'partial' });
    expect(agentCostFor(summary([row('a', 10, 0, 1, cost(1, 'partial'))]), ['a'])).toMatchObject({ usd: 1, coverage: 'partial' });
    expect(agentCostFor(summary([row('a', 10, 0, 1, cost(null, 'unavailable')), row('b', 10, 0, 1)]), ['a', 'b'])).toMatchObject({ usd: null, coverage: 'unavailable' });
  });
});

describe('formatting', () => {
  it('shows dollars and cents, flags tiny amounts, and says nothing for unknown cost', () => {
    expect(formatCost(1.2345)).toBe('$1.23');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1234.5)).toBe('$1,234.50');
    expect(formatCost(null)).toBe('—');
  });

  it('computes the share of input that came from cache', () => {
    expect(cachedShare({ inputTokens: 1000, cacheReadTokens: 900 })).toBe(0.9);
    expect(cachedShare({ inputTokens: 0, cacheReadTokens: 0 })).toBeNull();
  });
});
