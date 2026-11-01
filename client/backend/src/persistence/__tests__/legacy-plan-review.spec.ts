import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppStateStore } from '../store';
import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';

function fixture() {
  const snapshot = createInitialSnapshot();
  snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread' };
  const saved = persistedStateFromSnapshot(snapshot);
  const legacy = { agentId: snapshot.agents[0]!.id, conversationId: 'thread', id: 'old-plan', revision: 2, submitted: false, answers: { choices: { platform: 'mac' }, comments: { platform: 'Keep the original folder.' } }, history: [{ revision: 1, answers: { choices: {}, comments: { platform: 'Add a choice.' } }, submitted: true }], document: { title: 'Migration', sections: [{ id: 'platform', claim: 'Choose a platform', decision: { question: 'Where?', options: [{ id: 'mac', label: 'macOS' }, { id: 'linux', label: 'Linux' }], proposed: 'linux' } }] } };
  Object.assign(saved.agents[0]!, { interactivePlan: legacy });
  return { saved, legacy };
}
describe('saved structured plan migration', () => {
  it('restores Markdown, selections, comments and history without inventing approval authority', () => {
    const f = fixture();
    f.legacy.history[0]!.answers.comments.platform = 'Saved feedback. '.repeat(400);
    const restored = snapshotFromPersistedState(f.saved);
    const review = restored.agents[0]!.planReview!;
    expect(review.canApprove).toBe(false);
    expect(review.markdown).toContain('- ( ) macOS\n- (x) Linux');
    expect(review.draft).toStrictEqual({ comments: [{ id: 's1', sectionId: 's1', quote: 'Choose a platform', body: 'Keep the original folder.' }], choices: [{ id: 's1-g0', quote: 'Choose a platform\nmacOS\nLinux', selected: ['macOS'] }] });
    expect(review.history?.[0]?.markdown).toContain(f.legacy.history[0]!.answers.comments.platform);
    expect(snapshotFromPersistedState(persistedStateFromSnapshot(restored)).agents[0]!.planReview).toStrictEqual(review);
    expect(persistedStateFromSnapshot(restored).agents[0]).not.toHaveProperty('interactivePlan');
  });
  it('retains matching native approval identity but archives an unrelated old document', () => {
    const f = fixture();
    f.saved.agents[0]!.planReview = { id: 'native', conversationId: 'thread', turnId: 'turn', markdown: '# Migration\n\nPlan old-plan · revision 2\n\n' , status: 'pending' };
    expect(snapshotFromPersistedState(f.saved).agents[0]!.planReview).toMatchObject({ id: 'native', status: 'pending' });
    f.saved.agents[0]!.planReview.markdown = '# A different proposal';
    const native = snapshotFromPersistedState(f.saved).agents[0]!.planReview!;
    expect(native.markdown).toBe('# A different proposal');
    expect(native.history?.at(-1)?.markdown).toContain('Choose a platform');
  });
  it('migrates a saved roster without interpreting literal fields as Markdown structure', async () => {
    const f = fixture();
    Object.assign(f.legacy.document.sections[0]!, { detail: '# Literal heading\n\n- ( ) Literal option' });
    const home = await mkdtemp(path.join(os.tmpdir(), 'saved-plan-migration-'));
    try {
      const base = createInitialSnapshot();
      base.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread' };
      await new AppStateStore(home).save(base);
      const filename = path.join(home, 'roster.json');
      const roster = JSON.parse(await readFile(filename, 'utf8'));
      roster.data.agents[0].interactivePlan = f.legacy;
      await writeFile(filename, JSON.stringify(roster));
      const store = new AppStateStore(home);
      const restored = await store.load();
      expect(restored.agents[0]!.planReview?.markdown).toContain('\\# Literal heading');
      expect(restored.agents[0]!.planReview?.markdown).toContain('\\- \\( \\) Literal option');
      await store.save(restored);
      expect((await new AppStateStore(home).load()).agents[0]!.planReview).toStrictEqual(restored.agents[0]!.planReview);
      expect(JSON.parse(await readFile(filename, 'utf8')).data.agents[0]).not.toHaveProperty('interactivePlan');
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  it('ignores foreign saved plan ownership', () => {
    const f = fixture();
    f.legacy.conversationId = 'other';
    expect(snapshotFromPersistedState(f.saved).agents[0]!.planReview).toBeUndefined();
  });
});
