import { describe, expect, it } from 'vitest';
import { WindowRegistry, type ManagedWindow } from '../window-registry';

class FakeWindow implements ManagedWindow {
  destroyed = false;
  focused = false;
  constructor(readonly id: number) {}
  isDestroyed(): boolean { return this.destroyed; }
  isFocused(): boolean { return this.focused; }
}

function registryWith(count: number): { registry: WindowRegistry<FakeWindow>; windows: FakeWindow[] } {
  const registry = new WindowRegistry<FakeWindow>();
  const windows = Array.from({ length: count }, (_, index) => new FakeWindow(index + 1));
  for (const window of windows) registry.add(window);
  return { registry, windows };
}

describe('WindowRegistry', () => {
  it('targets the focused window, then the last focused, then any live window', () => {
    const { registry, windows: [first, second, third] } = registryWith(3);
    expect(registry.focused()).toBe(third);

    registry.markFocused(first!);
    expect(registry.focused()).toBe(first);

    second!.focused = true;
    expect(registry.focused()).toBe(second);

    second!.focused = false;
    first!.destroyed = true;
    expect(registry.focused()).toBe(third);
  });

  it('only lists live windows and tracks readiness per window', () => {
    const { registry, windows: [first, second] } = registryWith(2);
    registry.setReady(first!, true);
    expect(registry.readyWindows()).toEqual([first]);
    expect(registry.isReady(second!)).toBe(false);

    first!.destroyed = true;
    expect(registry.live()).toEqual([second]);
    expect(registry.readyWindows()).toEqual([]);
  });

  it('keeps one selection and one initial view state per window', () => {
    const registry = new WindowRegistry<FakeWindow>();
    const first = new FakeWindow(1);
    const second = new FakeWindow(2);
    registry.add(first);
    registry.add(second, { agentId: 'agent-b' });

    expect(registry.viewStateOf(first)).toBeNull();
    expect(registry.viewStateOf(second)).toEqual({ agentId: 'agent-b' });
    expect(registry.selectedAgentOf(second)).toBe('agent-b');

    registry.setSelectedAgent(first, 'agent-a');
    expect(registry.viewStateOf(first)).toEqual({ agentId: 'agent-a' });
    expect(registry.selectedAgentIds()).toEqual(new Set(['agent-a', 'agent-b']));
  });

  describe('native ownership', () => {
    it('grants the first claimant and refuses the others until they take over', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      expect(registry.claim(first!, 'browser', 'agent-1')).toEqual({ granted: true });
      expect(registry.claim(second!, 'browser', 'agent-1')).toEqual({ granted: false });
      expect(registry.ownerOf('browser', 'agent-1')).toBe(first);

      expect(registry.claim(second!, 'browser', 'agent-1', true)).toEqual({ granted: true, displaced: first });
      expect(registry.ownerOf('browser', 'agent-1')).toBe(second);
    });

    it('scopes ownership by resource and agent', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      registry.claim(first!, 'browser', 'agent-1');
      expect(registry.claim(second!, 'simulator', 'agent-1').granted).toBe(true);
      expect(registry.claim(second!, 'browser', 'agent-2').granted).toBe(true);
      expect(registry.nativeOwners()).toEqual([
        { resource: 'browser', agentId: 'agent-1', windowId: 1 },
        { resource: 'simulator', agentId: 'agent-1', windowId: 2 },
        { resource: 'browser', agentId: 'agent-2', windowId: 2 },
      ]);
    });

    it('frees a view only after its last claim is released', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      registry.claim(first!, 'browser', 'agent-1');
      registry.claim(first!, 'browser', 'agent-1');

      expect(registry.release(first!, 'browser', 'agent-1')).toBe(false);
      expect(registry.claim(second!, 'browser', 'agent-1').granted).toBe(false);
      expect(registry.release(first!, 'browser', 'agent-1')).toBe(true);
      expect(registry.claim(second!, 'browser', 'agent-1').granted).toBe(true);
    });

    it('ignores a release from a window that no longer owns the view', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      registry.claim(first!, 'browser', 'agent-1');
      registry.claim(second!, 'browser', 'agent-1', true);

      expect(registry.release(first!, 'browser', 'agent-1')).toBe(false);
      expect(registry.ownerOf('browser', 'agent-1')).toBe(second);
    });

    it('hands every view of a closed window back', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      registry.claim(first!, 'browser', 'agent-1');
      registry.claim(first!, 'simulator', 'agent-2');
      registry.claim(second!, 'browser', 'agent-3');

      expect(registry.remove(first!)).toEqual([
        { resource: 'browser', agentId: 'agent-1', windowId: 1 },
        { resource: 'simulator', agentId: 'agent-2', windowId: 1 },
      ]);
      expect(registry.nativeOwners()).toEqual([{ resource: 'browser', agentId: 'agent-3', windowId: 2 }]);
      expect(registry.claim(second!, 'browser', 'agent-1').granted).toBe(true);
    });

    it('lets a window claim a view whose owner was destroyed', () => {
      const { registry, windows: [first, second] } = registryWith(2);
      registry.claim(first!, 'browser', 'agent-1');
      first!.destroyed = true;
      expect(registry.ownerOf('browser', 'agent-1')).toBeUndefined();
      expect(registry.claim(second!, 'browser', 'agent-1')).toEqual({ granted: true });
    });
  });

  describe('composer drafts', () => {
    const draft = (text: string) => ({ state: { text, selectionStart: text.length, selectionEnd: text.length }, attachments: [] });

    it('keeps one draft per agent and drops it once the composer is emptied', () => {
      const { registry } = registryWith(1);
      registry.setDraft('agent-1', draft('hello'));
      registry.setDraft('agent-1', draft('hello world'));
      expect(registry.composerDrafts()).toEqual({ 'agent-1': draft('hello world') });

      registry.setDraft('agent-1', draft(''));
      expect(registry.composerDrafts()).toEqual({});
    });

    it('keeps a draft that only holds attachments', () => {
      const { registry } = registryWith(1);
      const attachment = { id: 'a', type: 'file' as const, reference: 'r', name: 'n', mimeType: 'text/plain', size: 1 };
      registry.setDraft('agent-1', { ...draft(''), attachments: [attachment] });
      expect(Object.keys(registry.composerDrafts())).toEqual(['agent-1']);
      registry.setDraft('agent-1', null);
      expect(registry.composerDrafts()).toEqual({});
    });
  });
});
