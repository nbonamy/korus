import { describe, expect, it } from 'vitest';
import { CompanionJournal } from '../companion-journal';
import type { ProviderConversationFrame } from '../contracts';
const frame = (revision: number, reset = false, agentId = 'agent') => ({ type: reset ? 'codex.conversationSnapshotChanged' : 'codex.conversationEventReceived', agentId, backend: 'codex', threadId: 'thread', payload: { revision, ...(reset ? { snapshot: {} } : { event: { type: 'conversation.updated', text: 'small update' } }) } }) as unknown as ProviderConversationFrame;
// Owns transport continuity and bounded retention; provider semantics stay opaque.
describe('companion frame checkpoints', () => {
  it('replays only missing frames, ignores duplicates, and rejects gaps and replaced baselines', () => {
    const journal = new CompanionJournal();
    journal.observe(frame(1, true));
    const start = journal.checkpoint('agent')!;
    journal.observe(frame(2)); journal.observe(frame(2)); journal.observe(frame(3));
    expect(journal.resume('agent', start)?.frames).toStrictEqual([frame(2), frame(3)]);
    const head = journal.checkpoint('agent')!;
    expect(journal.resume('agent', head)).toStrictEqual({ checkpoint: head, frames: [] });
    journal.observe(frame(5));
    expect(journal.resume('agent', head)).toBeNull();
    journal.observe(frame(1, true));
    expect(journal.resume('agent', start)).toBeNull();
  });
  it('covers fifteen seconds of rapid small streaming events without requiring a full snapshot', () => {
    const journal = new CompanionJournal(); journal.observe(frame(1, true));
    const checkpoint = journal.checkpoint('agent')!;
    for (let revision = 2; revision <= 901; revision++) journal.observe(frame(revision));
    const resumed = journal.resume('agent', checkpoint);
    expect(resumed?.frames.map(value => value.payload.revision)).toStrictEqual(Array.from({ length: 900 }, (_, index) => index + 2));
  });
  it('bounds retained event bytes and conversations without retaining snapshot media', () => {
    const journal = new CompanionJournal({ maxBytes: 600, maxConversations: 2 });
    journal.observe(frame(1, true)); const first = journal.checkpoint('agent')!;
    for (let n = 2; n < 12; n++) journal.observe(frame(n));
    expect(journal.resume('agent', first)).toBeNull();
    const latest = journal.checkpoint('agent')!;
    journal.observe(frame(1, true, 'b')); journal.observe(frame(1, true, 'c'));
    expect(journal.resume('agent', latest)).toBeNull();
    journal.clear(); expect(journal.checkpoint('c')).toBeNull();
  });
});

it('never retains app-private envelopes in resumable provider frames', () => {
  const journal = new CompanionJournal(); journal.observe(frame(1, true));
  const checkpoint = journal.checkpoint('agent')!;
  journal.observe({ ...frame(2), clientState: { secret: 'private-app-state' }, snapshot: { secret: 'private-app-snapshot' } } as unknown as ProviderConversationFrame);
  const replay = journal.resume('agent', checkpoint)!;
  expect(JSON.stringify(replay)).not.toContain('private-app');
  expect(replay.frames[0]?.payload).toStrictEqual(frame(2).payload);
});
