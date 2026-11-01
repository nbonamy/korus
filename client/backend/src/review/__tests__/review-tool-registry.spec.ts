import { describe, expect, it, vi } from 'vitest';
import type { CodeReviewFinding } from '@workspace/core/code-review';
import { ReviewToolRegistry } from '../review-tool-registry';

const finding = (): CodeReviewFinding => ({
  id: 'finding-1', roundId: 'round-1', priority: 'p1',
  title: 'Authorize before the write', body: 'The handler writes before checking ownership.',
  decision: { state: 'undecided' },
  discussion: [], remediation: { state: 'notStarted' },
  createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
});

describe('ReviewToolRegistry', () => {
  it('routes finding changes through an agent-scoped, durable session context', async () => {
    const registry = new ReviewToolRegistry();
    const handlers = {
      finishReviewRound: vi.fn(async ({ findingCount }: { findingCount: number }) => ({ roundId: 'round-1', findingCount })),
      reportFinding: vi.fn(async () => finding()),
      updateFinding: vi.fn(async () => ({ ...finding(), priority: 'p0' as const })),
      deleteFinding: vi.fn(async ({ findingId }: { findingId: string }) => ({ findingId, deleted: true as const })),
    };
    const context = registry.create('agent-1', 'review-session-1', handlers);

    await context.reportFinding({
      priority: 'p1', title: 'Authorize before the write',
      body: 'The handler writes before checking ownership.',
    });
    await context.updateFinding({
      findingId: 'finding-1', priority: 'p0', status: 'fixed', evidence: 'Focused test passes.',
    });
    await expect(context.deleteFinding({ findingId: 'finding-1' })).resolves.toStrictEqual({ findingId: 'finding-1', deleted: true });

    expect(handlers.reportFinding).toHaveBeenCalledOnce();
    expect(handlers.updateFinding).toHaveBeenCalledWith({
      findingId: 'finding-1', priority: 'p0', status: 'fixed', evidence: 'Focused test passes.',
    });
    expect(handlers.deleteFinding).toHaveBeenCalledWith({ findingId: 'finding-1' });
    expect(context.id).toBe('review-session-1');
    expect(registry.resolve('agent-2', context.id)).toBeNull();

    registry.close(context.id);
    expect(registry.resolve('agent-1', context.id)).toBeNull();
    expect(() => context.reportFinding({
      priority: 'p3', title: 'Handle this later', body: 'This can be handled later.',
    })).toThrow('no longer available');
  });
});
