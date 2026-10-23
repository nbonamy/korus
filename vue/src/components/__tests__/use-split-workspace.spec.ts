import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useSplitWorkspace } from '../use-split-workspace';

describe('split workspace selection', () => {
  // Storage failures and stale rosters are exercised here because the App fixture
  // cannot represent unavailable browser storage or a restart with a changed roster.
  it('restores occupied focus before following selection and clears departed agents on restart', async () => {
    const agents = ref(['a', 'b', 'c']);
    const current = ref('a');
    const options = {
      agentIds: () => agents.value,
      currentAgentId: () => current.value,
      teamId: () => 'restart-team',
      selectAgent: (id: string) => { current.value = id; },
    };
    let scope = effectScope();
    let split = scope.run(() => useSplitWorkspace(options))!;
    split.setLayout('4-quadrant');
    split.focus(split.panes.value[1]!.id);
    await nextTick();
    scope.stop();
    agents.value = ['a', 'b'];
    current.value = 'a';
    scope = effectScope();
    split = scope.run(() => useSplitWorkspace(options))!;
    await nextTick();
    try {
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['a', 'b', null, null]);
      expect(split.focusedPane.value.agentId).toBe('b');
      expect(current.value).toBe('b');
      split.setLayout('single');
      expect(split.focusedPane.value.agentId).toBe('b');
    } finally { scope.stop(); }
  });

  it.each(['{broken', '{"layout":"4-quadrant","panes":null}', '{"layout":"unknown"}'])('ignores corrupt saved workspaces: %s', raw => {
    localStorage.setItem('app:splitWorkspace:v1:invalid-team', raw);
    const scope = effectScope();
    try {
      const split = scope.run(() => useSplitWorkspace({
        agentIds: () => ['a'], currentAgentId: () => 'a', teamId: () => 'invalid-team', selectAgent: () => {},
      }))!;
      expect(split.layout.value).toBe('single');
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['a']);
    } finally { scope.stop(); }
  });

  it('keeps team switches usable when storage reads and writes fail', async () => {
    const team = ref('one');
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const scope = effectScope();
    try {
      const split = scope.run(() => useSplitWorkspace({
        agentIds: () => ['a', 'b'], currentAgentId: () => 'a', teamId: () => team.value, selectAgent: () => {},
      }))!;
      split.setLayout('2-vertical');
      team.value = 'two';
      await nextTick();
      split.setLayout('2-horizontal');
      team.value = 'one';
      await nextTick();
      expect(split.layout.value).toBe('2-vertical');
    } finally { scope.stop(); read.mockRestore(); write.mockRestore(); }
  });

  it('keeps each team layout, pane assignments and focus across switches', async () => {
    const scope = effectScope();
    const agents = ref(['a', 'b', 'c']);
    const current = ref('a');
    const team = ref('first');
    const split = scope.run(() => useSplitWorkspace({
      agentIds: () => agents.value,
      currentAgentId: () => current.value,
      teamId: () => team.value,
      selectAgent: (id) => { current.value = id; },
    }))!;
    const switchTeam = async (id: string, ids: string[], agentId: string) => {
      team.value = id;
      agents.value = ids;
      current.value = agentId;
      await nextTick();
    };
    try {
      split.setLayout('2-vertical');
      split.focus(split.panes.value[1]!.id);
      current.value = 'c';
      await nextTick();
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['a', 'c']);

      await switchTeam('second', ['d', 'e'], 'd');
      expect(split.layout.value).toBe('single');
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['d']);
      split.setLayout('4-quadrant');
      split.focus(split.panes.value[3]!.id);

      await switchTeam('first', ['a', 'b', 'c'], 'c');
      expect(split.layout.value).toBe('2-vertical');
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['a', 'c']);
      expect(split.focusedPane.value.agentId).toBe('c');

      await switchTeam('second', ['d', 'e'], 'd');
      expect(split.layout.value).toBe('4-quadrant');
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['d', 'e', null, null]);
      expect(split.focusedPane.value).toBe(split.panes.value[3]);

      await switchTeam('first', ['a', 'b'], 'a');
      expect(split.layout.value).toBe('2-vertical');
      expect(split.panes.value.map(pane => pane.agentId)).toStrictEqual(['a', null]);
      expect(split.focusedPane.value.agentId).toBe('a');
    } finally {
      scope.stop();
    }
  });

  it('fills the focused empty pane, avoids duplicates, and removes departed agents without following background updates', async () => {
    const scope = effectScope();
    const agents = ref(['a', 'b']);
    const current = ref('a');
    const team = ref('team');
    const split = scope.run(() =>
      useSplitWorkspace({
        agentIds: () => agents.value,
        currentAgentId: () => current.value,
        teamId: () => team.value,
        selectAgent: (id) => {
          current.value = id;
        },
      }),
    )!;
    try {
      split.setLayout('4-quadrant');
      const empty = split.panes.value[3]!;
      split.focus(empty.id);
      agents.value = [...agents.value];
      await nextTick();
      expect(split.focusedPaneId.value).toBe(empty.id);
      agents.value.push('c');
      current.value = 'c';
      await nextTick();
      expect(empty.agentId).toBe('c');
      current.value = 'b';
      await nextTick();
      expect(split.focusedPane.value.agentId).toBe('b');
      expect(
        split.panes.value.filter((pane) => pane.agentId === 'b'),
      ).toHaveLength(1);
      agents.value = ['a', 'c'];
      current.value = 'a';
      await nextTick();
      expect(split.panes.value.some((pane) => pane.agentId === 'b')).toBe(
        false,
      );
      split.setLayout('single');
      expect(split.panes.value.map((pane) => pane.agentId)).toEqual(['a']);
    } finally {
      scope.stop();
    }
  });
});
