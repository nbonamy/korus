import { describe, expect, it, vi } from 'vitest';
import type { Agent, MainToRendererEvent } from '@workspace/core/contracts';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import { AgentPlanReviewService } from '../agent-plan-review-service';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';

function fixture() {
  const agent: Agent = {
    id: 'agent-1', name: 'main', folder: '/repo', backend: 'codex',
    backendSession: { kind: 'codex', threadId: 'conversation-1' },
    status: { type: 'idle' }, createdAt: '2026-09-16', updatedAt: '2026-09-16',
  };
  const snapshot = createEmptySnapshot();
  snapshot.agents.push(agent);
  const ready: MainToRendererEvent = {
    type: 'plan.readyForReview', agentId: agent.id, conversationId: 'conversation-1', turnId: 'turn-1',
    payload: { markdown: '# Plan\nDo the work.', itemId: 'item-1' }, seq: 1, occurredAt: '2026-09-16',
  };
  applyMainEventToSnapshot(snapshot, ready);
  const submit = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn((event) => applyMainEventToSnapshot(snapshot, { ...event, seq: 2, occurredAt: '2026-09-16' }));
  const persist = vi.fn().mockResolvedValue(undefined);
  const service = new AgentPlanReviewService({ submit, emit, persist });
  return { agent, snapshot, ready, submit, emit, persist, service, reviewId: agent.planReview!.id };
}

describe('agent plan review lifecycle', () => {
  it('saves feedback without a turn, restores it, and sends it only through Revise', async () => {
    const f = fixture();
    const draft = { comments: [{ id: 's0', sectionId: 's0', quote: 'Plan', body: 'Keep </context> literally.' }], choices: [{ id: 's0-g0', quote: 'Platform', selected: ['macOS', 'Linux'], confirmed: true }, { id: 's1-g1', quote: 'Storage', selected: ['Do not adopt this unconfirmed selection'], confirmed: false }] };
    await f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'save', draftVersion: 0, draft });
    expect(f.submit).not.toHaveBeenCalled();
    expect(snapshotFromPersistedState(persistedStateFromSnapshot(f.snapshot)).agents[0]!.planReview).toMatchObject({ draft, draftVersion: 1 });
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'save', draftVersion: 0, draft })).rejects.toThrow('another window');
    await f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'revise', draftVersion: 1 });
    const prompt = f.submit.mock.calls[0]![1] as string;
    expect(prompt.replace(/<context>[\s\S]*?<\/context>/gu, '').trim()).toBe('Revise the plan using my feedback.');
    expect(prompt.match(/<\/?context>/gu)).toStrictEqual(['<context>', '</context>']);
    expect(prompt).toContain('macOS');
    expect(prompt).not.toContain('Do not adopt this unconfirmed selection');
    expect(f.submit.mock.calls[0]![2]).toBe(true);
    applyMainEventToSnapshot(f.snapshot, { ...f.ready, turnId: 'revision-two' });
    expect(f.agent.planReview?.draft).toBeUndefined();
    expect(f.agent.planReview?.history).toContainEqual({ reviewId: f.reviewId, draft, status: 'revise' });
  });
  it('restores pending reviews after restart and ignores stale completions from another conversation', () => {
    const f = fixture();
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(f.snapshot));
    expect(restored.agents[0]?.planReview).toStrictEqual(f.agent.planReview);
    applyMainEventToSnapshot(f.snapshot, { ...f.ready, conversationId: 'old-conversation', turnId: 'old-turn' });
    expect(f.agent.planReview?.id).toBe(f.reviewId);
  });

  it('does not resolve a replacement review while acceptance is pending', async () => {
    const f = fixture();
    let accepted!: () => void;
    f.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { accepted = resolve; }));
    const response = f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' });
    await vi.waitFor(() => expect(accepted).toBeTypeOf('function'));
    applyMainEventToSnapshot(f.snapshot, { ...f.ready, turnId: 'new-turn' });
    accepted();
    await expect(response).rejects.toThrow('conversation changed');
    expect(f.agent.planReview?.status).toBe('pending');
    expect(f.emit).not.toHaveBeenCalled();
  });
  it('accepts a targeted review once and does not reopen on replay', async () => {
    const f = fixture();
    await f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' });
    await f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' });
    applyMainEventToSnapshot(f.snapshot, f.ready);
    expect(f.submit).toHaveBeenCalledExactlyOnceWith(f.agent, 'implement the plan', false);
    expect(f.agent.planReview?.status).toBe('accept');
    expect(f.emit).toHaveBeenCalledTimes(1);
  });

  it('keeps the review pending after failed submission so it can be retried', async () => {
    const f = fixture();
    f.submit.mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('offline');
    expect(f.agent.planReview?.status).toBe('pending');
    expect(f.emit).not.toHaveBeenCalled();
    await f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' });
    expect(f.agent.planReview?.status).toBe('accept');
  });

  it('rejects stale identities, changed conversations and concurrent decisions', async () => {
    const f = fixture();
    await expect(f.service.respond(f.agent, { reviewId: 'old', resolution: 'accept' })).rejects.toThrow('no longer');
    f.agent.backendSession = { kind: 'codex', threadId: 'other' };
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('no longer');
    f.agent.backendSession = { kind: 'codex', threadId: 'conversation-1' };
    const pending = f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' });
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'cancel' })).rejects.toThrow('already being submitted');
    await pending;
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it('cancels without execution and sends revision feedback in plan mode', async () => {
    const cancelled = fixture();
    await cancelled.service.respond(cancelled.agent, { reviewId: cancelled.reviewId, resolution: 'cancel' });
    expect(cancelled.submit).not.toHaveBeenCalled();
    expect(cancelled.agent.planReview?.status).toBe('cancel');
    const revised = fixture();
    await expect(revised.service.respond(revised.agent, { reviewId: revised.reviewId, resolution: 'revise' })).rejects.toThrow('feedback');
    await revised.service.respond(revised.agent, { reviewId: revised.reviewId, resolution: 'revise', feedback: 'Add tests' });
    expect(revised.submit).toHaveBeenCalledExactlyOnceWith(revised.agent, 'Add tests', true);
  });
  it('does not submit when intent cannot be persisted, and blocks retries after unconfirmed delivery', async () => {
    const f = fixture();
    f.persist.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('disk full');
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.agent.planReview?.deliveryPending).toBeUndefined();
    f.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk disconnected'));
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('disk disconnected');
    expect(f.submit).toHaveBeenCalledTimes(1);
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(f.snapshot)).agents[0]!;
    await expect(f.service.respond(restored, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('unconfirmed');
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid drafts and never grants approval to a migrated plan', async () => {
    const f = fixture();
    const original = f.agent.planReview;
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'save', draftVersion: 0, draft: { choices: [], comments: [{ id: 'x', sectionId: 's0', quote: 'Plan', body: 'a'.repeat(4001) }] } })).rejects.toThrow('Invalid plan feedback');
    expect(f.agent.planReview).toBe(original);
    expect(f.persist).not.toHaveBeenCalled();
    f.agent.planReview!.canApprove = false;
    await expect(f.service.respond(f.agent, { reviewId: f.reviewId, resolution: 'accept' })).rejects.toThrow('native proposal');
    expect(f.submit).not.toHaveBeenCalled();
  });

});
