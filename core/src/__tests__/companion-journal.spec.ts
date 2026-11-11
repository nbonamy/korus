import { describe, expect, it } from 'vitest';
import { CompanionJournal } from '../companion-journal';
import type { CompanionConversationFrame } from '../companion-protocol';

const state = { messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null };
const frame = (revision: number, reset = false, agentId = 'agent', epoch = 'epoch'): CompanionConversationFrame => reset
  ? { type: 'conversation.sessionSnapshot', agentId, provider: 'codex', payload: { conversation: 'thread', epoch, snapshot: { revision, state } } }
  : { type: 'conversation.sessionPatch', agentId, provider: 'codex', payload: { conversation: 'thread', epoch, patch: { revision, ops: [{ op: 'set', key: 'title', value: 'small update' }] } } };
const revisions = (frames: CompanionConversationFrame[] | undefined) => frames?.map(value => value.type === 'conversation.sessionPatch' ? value.payload.patch.revision : -1);

// Owns transport continuity and bounded retention over neutral session frames.
describe('companion frame checkpoints', () => {
  it('replays only missing patches, ignores duplicates, and rejects gaps and replaced baselines', () => {
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
  it('keeps resuming across a snapshot of the state it already holds, and ignores an older one', () => {
    const journal = new CompanionJournal();
    journal.observe(frame(1, true)); const start = journal.checkpoint('agent')!;
    journal.observe(frame(2)); journal.observe(frame(3));
    journal.observe(frame(3, true)); journal.observe(frame(2, true));
    expect(journal.checkpoint('agent')).toStrictEqual({ epoch: start.epoch, revision: 3 });
    expect(revisions(journal.resume('agent', start)?.frames)).toStrictEqual([2, 3]);
  });
  it('starts over on another stream, and forgets a patch that belongs to none it holds', () => {
    const journal = new CompanionJournal();
    journal.observe(frame(1, true)); const start = journal.checkpoint('agent')!;
    journal.observe(frame(4, true, 'agent', 'restarted'));
    expect(journal.resume('agent', start)).toBeNull();
    const restarted = journal.checkpoint('agent')!;
    expect(restarted).toMatchObject({ revision: 4 });
    journal.observe(frame(5, false, 'agent', 'other'));
    expect(journal.checkpoint('agent')).toBeNull();
    expect(journal.resume('agent', restarted)).toBeNull();
  });
  it('covers fifteen seconds of rapid small streaming patches without requiring a full snapshot', () => {
    const journal = new CompanionJournal(); journal.observe(frame(1, true));
    const checkpoint = journal.checkpoint('agent')!;
    for (let revision = 2; revision <= 901; revision++) journal.observe(frame(revision));
    expect(revisions(journal.resume('agent', checkpoint)?.frames)).toStrictEqual(Array.from({ length: 900 }, (_, index) => index + 2));
  });
  it('bounds retained patch bytes and conversations without retaining snapshots', () => {
    const journal = new CompanionJournal({ maxBytes: 1200, maxConversations: 2 });
    journal.observe(frame(1, true)); const first = journal.checkpoint('agent')!;
    for (let n = 2; n < 12; n++) journal.observe(frame(n));
    expect(journal.resume('agent', first)).toBeNull();
    const latest = journal.checkpoint('agent')!;
    journal.observe(frame(1, true, 'b')); journal.observe(frame(1, true, 'c'));
    expect(journal.resume('agent', latest)).toBeNull();
    journal.clear(); expect(journal.checkpoint('c')).toBeNull();
  });
});

it('never retains app-private envelopes in resumable frames', () => {
  const journal = new CompanionJournal(); journal.observe(frame(1, true));
  const checkpoint = journal.checkpoint('agent')!;
  journal.observe({ ...frame(2), clientState: { secret: 'private-app-state' }, snapshot: { secret: 'private-app-snapshot' } } as unknown as CompanionConversationFrame);
  const replay = journal.resume('agent', checkpoint)!;
  expect(JSON.stringify(replay)).not.toContain('private-app');
  expect(replay.frames[0]?.payload).toStrictEqual(frame(2).payload);
});
