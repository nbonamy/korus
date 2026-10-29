import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexSdkFixture, sdkAgent, sdkSnapshot } from './sdk-surface-fixture';

afterEach(() => vi.useRealTimers());

describe('Codex code review boundary', () => {
  it('waits for a long current-thread review to finish before restoring its normal tools', async () => {
    vi.useFakeTimers();
    const { driver, conversation, surface } = codexSdkFixture();
    const agent = sdkAgent();
    const current = conversation('conversation-a');
    current.setSnapshot({ turnIds: [], messages: [] });
    current.handle.sendMessage.mockResolvedValue(sdkSnapshot('conversation-a', {
      turnIds: ['turn-review'],
      turns: [{ id: 'turn-review', status: 'inProgress' } as never],
    }));

    const result = driver.runCodeReview(agent, {
      cwd: '/repo',
      prompt: 'Review in this conversation.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?reviewContextId=current',
      reviewerSession: agent.backendSession,
    });
    let outcome: unknown = 'pending';
    void result.then(value => { outcome = value; }, error => { outcome = error; });
    await vi.advanceTimersByTimeAsync(31 * 60 * 1_000);
    expect(outcome).toBe('pending');
    expect(current.handle.load).toHaveBeenCalledTimes(2);
    const completion = { status: 'completed' as const, error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null };
    current.emit({ type: 'turn.completed', conversationId: current.handle.id, turnId: 'other-turn', seq: 1, origin: 'notification', occurredAt: '', payload: completion });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('pending');
    current.emit({ type: 'turn.completed', conversationId: current.handle.id, turnId: 'turn-review', seq: 2, origin: 'notification', occurredAt: '', payload: completion });
    await expect(result).resolves.toEqual({ text: '', reviewerSession: agent.backendSession });

    expect(current.handle.load.mock.calls).toStrictEqual([
      [{ cwd: '/repo', extensionContext: agent }],
      [{ extensionContext: { agent, reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?reviewContextId=current' } }],
      [{ cwd: '/repo', extensionContext: agent }],
    ]);
    expect(current.handle.sendMessage).toHaveBeenCalledWith('Review in this conversation.');
    expect(surface.archiveConversation).not.toHaveBeenCalled();
    expect(surface.forgetConversation).not.toHaveBeenCalled();
  });

  it('creates a fresh reviewer conversation and keeps it available for later round turns', async () => {
    const { driver, surface, conversation, events } = codexSdkFixture();
    const agent = {
      ...sdkAgent(),
      backendSession: undefined,
      backendDefaults: {
        kind: 'codex' as const,
        model: 'gpt-6-astra',
        reasoningEffort: 'high',
      },
    };
    const review = conversation('review-fresh');
    surface.createConversation.mockResolvedValue(sdkSnapshot('review-fresh'));
    review.setSnapshot({
      turnIds: [],
      messages: [{
        id: 'review-answer', role: 'assistant', status: 'complete', turnId: 'turn-review',
        parts: [{ type: 'text', text: 'The finding is reachable.' }],
        createdAt: '2026-09-19T10:00:00.000Z',
      }],
    });
    review.handle.sendMessage.mockResolvedValue(sdkSnapshot('review-fresh', {
      turnIds: ['turn-review'],
      turns: [{ id: 'turn-review', status: 'completed' } as never],
    }));

    const result = await driver.runCodeReview(agent, {
      cwd: '/repo',
      prompt: 'Review independently and report findings.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-1',
    });

    expect(surface.createConversation).toHaveBeenCalledWith(
      {
        cwd: '/repo',
        threadSource: 'user',
        model: 'gpt-6-astra',
        reasoningEffort: 'high',
      },
      { extensionContext: {
        agent,
        reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-1',
      } },
    );
    expect(review.handle.load).toHaveBeenNthCalledWith(1, {
      extensionContext: { agent, reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-1' },
    });
    expect(review.handle.sendMessage).toHaveBeenCalledWith('Review independently and report findings.', {
      model: 'gpt-6-astra',
      reasoningEffort: 'high',
    });
    expect(review.handle.startReview).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: 'The finding is reachable.',
      reviewerSession: { kind: 'codex', threadId: 'review-fresh' },
    });
    expect(surface.archiveConversation).not.toHaveBeenCalled();
    expect(surface.forgetConversation).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      agentId: agent.id,
      type: 'agent.conversationAttached',
      conversationId: 'review-fresh',
    }));

    review.setSnapshot({ turnIds: ['turn-review'], messages: [] });
    review.handle.sendMessage.mockResolvedValue(sdkSnapshot('review-fresh', {
      turnIds: ['turn-review', 'turn-follow-up'],
      turns: [{ id: 'turn-follow-up', status: 'completed' } as never],
    }));
    await driver.runCodeReview({ ...agent, backendSession: result.reviewerSession }, {
      cwd: '/repo',
      prompt: 'Clarify the finding.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-2',
      reviewerSession: result.reviewerSession,
    });

    expect(review.handle.load).toHaveBeenCalledWith({
      extensionContext: {
        agent: { ...agent, backendSession: result.reviewerSession },
        reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-2',
      },
    });
    expect(review.handle.sendMessage).toHaveBeenCalledWith('Clarify the finding.', {
      model: 'gpt-6-astra',
      reasoningEffort: 'high',
    });

    expect(surface.archiveConversation).not.toHaveBeenCalled();
    expect(surface.forgetConversation).not.toHaveBeenCalled();
  });

  it('accepts a completed final answer when Codex labels the ordinary review turn interrupted', async () => {
    const { driver, surface, conversation } = codexSdkFixture();
    const review = conversation('review-fresh');
    surface.createConversation.mockResolvedValue(sdkSnapshot('review-fresh'));
    review.setSnapshot({
      turnIds: [],
      messages: [{
        id: 'review-answer', role: 'assistant', status: 'complete', turnId: 'turn-review',
        parts: [{ type: 'text', text: 'Review complete.', phase: 'final_answer' }],
        createdAt: '2026-09-19T10:00:00.000Z',
      }],
    });
    review.handle.sendMessage.mockResolvedValue(sdkSnapshot('review-fresh', {
      turnIds: ['turn-review'],
      turns: [{ id: 'turn-review', status: 'interrupted' } as never],
    }));

    await expect(driver.runCodeReview({ ...sdkAgent(), backendSession: undefined }, {
      cwd: '/repo',
      prompt: 'Review independently and report findings.',
      reviewMcpServerUrl: 'http://127.0.0.1:4321/mcp?agentId=agent-a&reviewContextId=review-1',
    })).resolves.toEqual({
      text: 'Review complete.',
      reviewerSession: { kind: 'codex', threadId: 'review-fresh' },
    });
    expect(surface.archiveConversation).not.toHaveBeenCalled();
    expect(surface.forgetConversation).not.toHaveBeenCalled();
  });
});
