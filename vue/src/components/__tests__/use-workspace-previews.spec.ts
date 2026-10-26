import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AgentGitDiff } from '@workspace/core/contracts';
import { useRightWorkspaceState } from '../use-right-workspace-state';
import { useWorkspacePreviews } from '../use-workspace-previews';

function setup(getAgentGitDiff: (id: string) => Promise<AgentGitDiff>) {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  const workspace = effectScope().run(() => useRightWorkspaceState({ currentAgentId: () => snapshot.activeAgentId ?? undefined, workspaceBody: () => null }))!;
  const previewAgentFile = vi.fn();
  const downloadAgentFile = vi.fn().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const previews = useWorkspacePreviews({
    currentAgent: () => snapshot.agents.find((item) => item.id === snapshot.activeAgentId) ?? null,
    getSnapshot: () => snapshot,
    getAgentGitDiff,
    previewAgentFile,
    downloadAgentFile,
    reportError,
    workspaceFor: workspace.workspaceFor,
    openTab: workspace.openTab,
    closeTab: workspace.closeTab,
  });
  return { agent, snapshot, workspace, previews, previewAgentFile, downloadAgentFile, reportError };
}

const result: AgentGitDiff = {
  target: { type: 'staged' }, diff: 'staged patch', sections: [],
  summary: { addedLines: 1, removedLines: 0, changedFiles: 1 },
};

describe('workspace diff queries', () => {
  it.each(['binary', 'tooLarge'])('downloads %s chat files without opening or replacing sidebar tabs', async kind => {
    const state = setup(vi.fn());
    state.workspace.openTab('review', state.agent.id);
    state.previewAgentFile.mockResolvedValue({ path: 'film.mp4', size: 100, kind });
    await state.previews.openConversationFile({ kind: 'file', path: 'film.mp4', href: 'film.mp4' });
    expect(state.downloadAgentFile).toHaveBeenCalledWith(state.agent.id, 'film.mp4');
    expect(state.workspace.workspaceFor(state.agent.id).tabs).toEqual(['review']);
    expect(state.workspace.workspaceFor(state.agent.id).filePanels).toEqual({});
    state.downloadAgentFile.mockRejectedValueOnce(new Error('Transfer failed'));
    await state.previews.openConversationFile({ kind: 'file', path: 'film.mp4', href: 'film.mp4' });
    expect(state.reportError).toHaveBeenCalledWith('Transfer failed');
  });

  it('keeps a delayed query result attached to its initiating agent', async () => {
    let resolve!: (value: AgentGitDiff) => void;
    const state = setup(() => new Promise((done) => { resolve = done; }));
    const pending = state.previews.openAgentGitDiff(state.agent.id);
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel?.state).toBe('loading');
    state.snapshot.activeAgentId = state.snapshot.agents[1]!.id;
    resolve(result);
    await pending;
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ diff: 'staged patch', state: 'idle' });
    expect(state.workspace.workspaceFor(state.snapshot.activeAgentId).gitReviewPanel).toBeNull();
  });

  it('ignores an older request failure after a newer target has loaded', async () => {
    let reject!: (error: Error) => void;
    const query = vi.fn<() => Promise<AgentGitDiff>>()
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce(result);
    const state = setup(query);
    const oldRequest = state.previews.openAgentGitDiff(state.agent.id, { type: 'uncommitted' });
    await state.previews.openAgentGitDiff(state.agent.id, { type: 'staged' });
    reject(new Error('obsolete failure'));
    await oldRequest;
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ target: { type: 'staged' }, state: 'idle', diff: 'staged patch', error: null });
  });

  it('keeps the requested file type focus on the loading and the loaded review, with a fresh sequence each time', async () => {
    const state = setup(vi.fn().mockResolvedValue(result));
    const open = state.previews.openAgentGitDiff(state.agent.id, { type: 'staged' }, 'test');
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ state: 'loading', focusKind: 'test', focusSequence: 1 });
    await open;
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ state: 'idle', diff: 'staged patch', focusKind: 'test', focusSequence: 1 });
    await state.previews.openAgentGitDiff(state.agent.id, { type: 'staged' }, 'docs');
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ focusKind: 'docs', focusSequence: 2 });
    await state.previews.openAgentGitDiff(state.agent.id, { type: 'staged' });
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).not.toHaveProperty('focusKind');
  });

  it('renders a query error locally and treats an empty diff as success', async () => {
    const query = vi.fn<() => Promise<AgentGitDiff>>()
      .mockRejectedValueOnce(new Error('Git unavailable'))
      .mockResolvedValueOnce({ ...result, diff: '' });
    const state = setup(query);
    await state.previews.openAgentGitDiff(state.agent.id);
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ state: 'error', error: 'Git unavailable' });
    await state.previews.openAgentGitDiff(state.agent.id);
    expect(state.workspace.workspaceFor(state.agent.id).gitReviewPanel).toMatchObject({ state: 'idle', error: null, diff: '' });
  });
});
