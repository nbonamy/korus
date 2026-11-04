import type { DesignContent, DesignDocument } from '@workspace/core/design';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignHistory, forgetDesignHistory, pruneDesignHistory } from '../design-history';

const content = (title: string): DesignContent => ({ title, css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 960, height: 640, root: { id: 'root', tag: 'main' } }] });
const document = (revision: number, title = `v${revision}`, id = 'design-1'): DesignDocument => ({ id, revision, content: content(title) });
const key = (agentId: string) => `design-history:${agentId}`;
const stored = (agentId: string) => JSON.parse(localStorage.getItem(key(agentId)) ?? 'null');

beforeEach(() => localStorage.clear());

describe('design history', () => {
  it('stacks the previous content whenever a new revision is seen, whoever made the edit', () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    expect(history.canUndo.value).toBe(false);
    history.observe(document(2));
    history.observe(document(3));
    expect(history.canUndo.value).toBe(true);
    expect(history.canRedo.value).toBe(false);
    expect(stored('agent-1')).toMatchObject({ documentId: 'design-1', revision: 3, undo: [content('v1'), content('v2')], redo: [] });
  });
  it('ignores repeated observations of the same revision', () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    history.observe(document(2));
    expect(stored('agent-1').undo).toHaveLength(1);
  });
  it('undoes and redoes by sending the earlier content, moving entries between the stacks', async () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    const sent: DesignContent[] = [];
    await history.step('undo', async target => { sent.push(target); const saved = { id: 'design-1', revision: 3, content: target }; history.observe(saved); return saved; });
    expect(sent).toEqual([content('v1')]);
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(true);
    expect(stored('agent-1')).toMatchObject({ revision: 3, undo: [], redo: [content('v2')] });
    // A caller that has not yet observed the saved document is covered by the returned one.
    await history.step('redo', async target => { sent.push(target); return { id: 'design-1', revision: 4, content: target }; });
    expect(sent[1]).toEqual(content('v2'));
    expect(history.canUndo.value).toBe(true);
    expect(history.canRedo.value).toBe(false);
    history.observe({ id: 'design-1', revision: 4, content: content('v2') });
    expect(stored('agent-1')).toMatchObject({ revision: 4, undo: [content('v1')], redo: [] });
  });
  it('keeps both stacks when the daemon refuses the change', async () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    await history.step('undo', async () => false);
    expect(history.canUndo.value).toBe(true);
    expect(history.canRedo.value).toBe(false);
  });
  it('clears redo when a new edit follows an undo', async () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    await history.step('undo', async target => { const saved = { id: 'design-1', revision: 3, content: target }; history.observe(saved); return saved; });
    history.observe(document(4, 'agent edit'));
    expect(history.canRedo.value).toBe(false);
    expect(history.canUndo.value).toBe(true);
  });
  it('keeps the latest thirty entries', () => {
    const history = createDesignHistory('agent-1');
    for (let revision = 1; revision <= 40; revision++) history.observe(document(revision));
    expect(stored('agent-1').undo).toHaveLength(30);
    expect(stored('agent-1').undo[0]).toEqual(content('v10'));
  });
  it('starts over for a different design', () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    history.observe(document(1, 'other', 'design-2'));
    expect(history.canUndo.value).toBe(false);
    expect(stored('agent-1')).toMatchObject({ documentId: 'design-2', undo: [] });
  });
  it('restores saved history after a restart while the revision still matches', () => {
    const first = createDesignHistory('agent-1');
    first.observe(document(1));
    first.observe(document(2));
    const restarted = createDesignHistory('agent-1');
    restarted.observe(document(2));
    expect(restarted.canUndo.value).toBe(true);
  });
  it('drops saved history after a restart when the revision changed meanwhile', () => {
    const first = createDesignHistory('agent-1');
    first.observe(document(1));
    first.observe(document(2));
    const restarted = createDesignHistory('agent-1');
    restarted.observe(document(5));
    expect(restarted.canUndo.value).toBe(false);
    expect(stored('agent-1')).toMatchObject({ revision: 5, undo: [] });
  });
  it('ignores unreadable saved history', () => {
    localStorage.setItem(key('agent-1'), '{not json');
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    expect(history.canUndo.value).toBe(false);
  });
  it('removes its entry when the design is gone', () => {
    const history = createDesignHistory('agent-1');
    history.observe(document(1));
    history.observe(document(2));
    history.observe(null);
    expect(localStorage.getItem(key('agent-1'))).toBeNull();
  });
  it('keeps working when storage is unavailable or full', () => {
    const history = createDesignHistory('agent-1');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    try {
      history.observe(document(1));
      history.observe(document(2));
      expect(history.canUndo.value).toBe(true);
    } finally { Storage.prototype.setItem = original; }
  });
  it('forgets one design and prunes designs of agents that no longer exist', () => {
    for (const agent of ['a', 'b', 'c']) { const history = createDesignHistory(agent); history.observe(document(1)); history.observe(document(2)); }
    localStorage.setItem('unrelated', 'kept');
    forgetDesignHistory('a');
    expect(localStorage.getItem(key('a'))).toBeNull();
    pruneDesignHistory(new Set(['c']));
    expect(localStorage.getItem(key('b'))).toBeNull();
    expect(localStorage.getItem(key('c'))).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });
});
