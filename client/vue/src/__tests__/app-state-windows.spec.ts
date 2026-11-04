import { describe, expect, it, vi } from 'vitest';
import { useAppState } from '../app-state';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AppApi } from '@workspace/core/contracts';
import type { ComposerDraft, ComposerDraftChange as ComposerChange, WindowContext } from '@workspace/core/windows';
import { stubElectronTestWindow } from '../test/client';

const draft = (text: string): ComposerDraft => ({ state: { text, selectionStart: text.length, selectionEnd: text.length }, attachments: [] });
const composerState = (text: string) => draft(text).state;

async function loadWindow(context: Partial<WindowContext> = {}, overrides: Partial<AppApi> = {}) {
  let onDraft: (change: ComposerChange) => void = () => undefined;
  const syncComposerDraft = vi.fn().mockResolvedValue(undefined);
  const setWindowSelection = vi.fn().mockResolvedValue(undefined);
  const app = {
    getSnapshot: vi.fn().mockResolvedValue(createInitialSnapshot()),
    onEvent: vi.fn(() => () => undefined),
    getWindowContext: vi.fn().mockResolvedValue({ windowId: 7, viewState: null, nativeOwners: [], composerDrafts: {}, ...context }),
    setWindowSelection,
    syncComposerDraft,
    onComposerDraftChanged: vi.fn((listener: (change: ComposerChange) => void) => { onDraft = listener; return () => undefined; }),
    onNativeOwnersChanged: vi.fn(() => () => undefined),
    ...overrides,
  } satisfies Partial<AppApi>;
  stubElectronTestWindow({ app });
  const state = useAppState();
  await state.loadSnapshot();
  return { app: { setWindowSelection, syncComposerDraft }, state, receiveDraft: (change: ComposerChange) => onDraft(change) };
}

describe('useAppState in one of several windows', () => {
  it('starts on the agent its window was opened with, without changing the daemon’s selection', async () => {
    const { app, state } = await loadWindow({ viewState: { agentId: 'agent-jesse' } });
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
    expect(app.setWindowSelection).toHaveBeenLastCalledWith('agent-jesse');
  });

  it('keeps the daemon’s selection when the window has no initial view state, and ignores unknown agents', async () => {
    const plain = await loadWindow();
    expect(plain.state.activeAgent.value?.id).toBe(createInitialSnapshot().activeAgentId);
    const unknown = await loadWindow({ viewState: { agentId: 'agent-gone' } });
    expect(unknown.state.activeAgent.value?.id).toBe(createInitialSnapshot().activeAgentId);
  });

  it.each(['openAgentPath', 'updateMission'] as const)('keeps its own agent when %s returns the daemon’s last selection from another window', async (call) => {
    const fromOtherWindow = { ...createInitialSnapshot(), activeAgentId: 'agent-dina' };
    const { state } = await loadWindow({ viewState: { agentId: 'agent-jesse' } }, {
      openAgentPath: vi.fn().mockResolvedValue(fromOtherWindow),
      updateMission: vi.fn().mockResolvedValue(fromOtherWindow),
    });
    if (call === 'openAgentPath') await state.openAgentPath('agent-jesse', 'finder');
    else await state.updateMission({ missionId: 'm', stage: 'requirements' } as never);
    expect(state.activeAgent.value?.id).toBe('agent-jesse');
  });

  it('tells main which agent this window shows as the user switches', async () => {
    const { app, state } = await loadWindow();
    await state.selectAgent('agent-jesse');
    await vi.waitFor(() => expect(app.setWindowSelection).toHaveBeenLastCalledWith('agent-jesse'));
  });

  it('shares composer edits as one draft per agent and stops sending when nothing changed', async () => {
    const { app, state } = await loadWindow();
    state.updateComposerState('agent-dina', composerState('hel'));
    state.updateComposerState('agent-dina', composerState('hello'));
    state.updateComposerState('agent-dina', composerState('hello'));
    expect(app.syncComposerDraft.mock.calls).toEqual([
      ['agent-dina', draft('hel')],
      ['agent-dina', draft('hello')],
    ]);

    state.updateComposerState('agent-dina', composerState(''));
    expect(app.syncComposerDraft).toHaveBeenLastCalledWith('agent-dina', null);
  });

  it('shares drafts with attachments as plain data that IPC can clone', async () => {
    const { app, state } = await loadWindow();
    state.updateComposerAttachments('agent-dina', [{ id: 'a', type: 'image', reference: 'ref', name: 'pasted.png', mimeType: 'image/png', size: 3, previewUrl: 'data:image/png;base64,AAAA' }]);
    state.updateComposerState('agent-dina', composerState('look'));
    for (const [, shared] of app.syncComposerDraft.mock.calls) expect(() => structuredClone(shared)).not.toThrow();
    expect(app.syncComposerDraft).toHaveBeenLastCalledWith('agent-dina', expect.objectContaining({ attachments: [expect.objectContaining({ name: 'pasted.png' })] }));
  });

  it('shows a draft typed in another window without sending it back', async () => {
    const { app, state, receiveDraft } = await loadWindow();
    receiveDraft({ agentId: 'agent-dina', draft: draft('typed elsewhere') });
    expect(state.activeComposerState.value.text).toBe('typed elsewhere');
    // The composer re-reporting what it was just given is not an edit.
    state.updateComposerState('agent-dina', composerState('typed elsewhere'));
    expect(app.syncComposerDraft).not.toHaveBeenCalled();

    receiveDraft({ agentId: 'agent-dina', draft: null });
    expect(state.activeComposerState.value.text).toBe('');
  });

  it('opens with the drafts that already exist in other windows', async () => {
    const { state } = await loadWindow({ composerDrafts: { 'agent-dina': draft('half-written') } });
    expect(state.activeComposerState.value.text).toBe('half-written');
  });
});
