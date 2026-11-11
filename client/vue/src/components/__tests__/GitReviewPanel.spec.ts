import { ElSegmented, ElSwitch } from 'element-plus';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, provide, ref } from 'vue';
import { normalizeGeneralSettings, defaultGeneralSettings } from '@workspace/core/settings';
import { summarizeUnifiedDiff } from '@workspace/core/unified-diff-stats';
import { createGeneralPreferences, generalPreferencesKey } from '../../general-preferences';
import GitDiffControl from '../GitDiffControl.vue';
import GitDiffTreemap from '../GitDiffTreemap.vue';
import SettingsGeneralPanel from '../SettingsGeneralPanel.vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GitReviewPanel from '../GitReviewPanel.vue';
// Menus open in a popper attached to the body.
const bodyAll = (selector: string) => Array.from(document.body.querySelectorAll(selector)).map((element) => new DOMWrapper(element));

const diff = [
  'diff --git a/src/main.ts b/src/main.ts',
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1 +1,2 @@',
  '-export const oldValue = 1;',
  '+export const newValue = 2;',
  '+export const anotherValue = 3;',
].join('\n');

const scopedDiffs = [
  { scope: 'staged' as const, diff: diff.replaceAll('src/main.ts', 'src/staged.ts') },
  { scope: 'unstaged' as const, diff: diff.replaceAll('src/main.ts', 'src/unstaged.ts') },
  { scope: 'untracked' as const, diff: diff.replaceAll('src/main.ts', 'src/untracked.ts') },
];

describe('GitReviewPanel', () => {
  it('shares the off-by-default lockfile preference between Code settings, Git stats, Changes and Map', async () => {
    const general = ref({ ...defaultGeneralSettings });
    const preferences = createGeneralPreferences(() => general.value, async input => { general.value = normalizeGeneralSettings({ ...general.value, ...input }); });
    const lock = ['diff --git a/nested/package-lock.json b/nested/package-lock.json', '--- a/nested/package-lock.json', '+++ b/nested/package-lock.json', '@@ -1 +1,2 @@', '-old', '+generated', '+another generated line'].join('\n');
    const patch = `${diff}\n${lock}`;
    const summary = summarizeUnifiedDiff(patch);
    const status = { folder: '/repo', state: 'dirty' as const, ahead: 0, behind: 0, hasUntracked: false, updatedAt: '', ...summary };
    const panel = { kind: 'gitDiff' as const, title: 'Changes', diff: patch, state: 'idle' as const, error: null, summary };
    const Host = defineComponent({ setup() {
      provide(generalPreferencesKey, preferences);
      return () => h('div', [
        h(SettingsGeneralPanel, { settings: general.value, updateSettings: input => preferences.update(input.general ?? {}) }),
        h(GitDiffControl, { agentId: 'a', gitStatus: status }),
        h(GitReviewPanel, { agent: { id: 'a', folder: '/repo' } as never, gitStatus: status, panel }),
      ]);
    } });
    const wrapper = mount(Host, { attachTo: document.body, global: { components: { ElSegmented, ElSwitch }, stubs: { GitDiffTreemapChart: true } } });
    try {
      const setting = () => wrapper.get('input[aria-label="Exclude lockfiles"]');
      expect(wrapper.get('#settings-general-source-title').text()).toBe('Code');
      expect(wrapper.getComponent(SettingsGeneralPanel).text()).toContain('Git operations still include them.');
      expect((setting().element as HTMLInputElement).checked).toBe(false);
      expect(wrapper.get('.git-diff-control__files').text()).toBe('2');
      expect(wrapper.get('.git-review-panel__added').text()).toBe('+4');
      await wrapper.get('[aria-label="Choose repository diff"]').trigger('click');
      await flushPromises();
      const toggle = bodyAll('[role="menuitemcheckbox"]').find(row => row.text().includes('Exclude lockfiles'))!;
      expect(toggle.find('svg.tabler-icon-lock-off').exists()).toBe(true);
      await toggle.trigger('click');
      await flushPromises();
      expect(general.value.excludeLockfilesFromDiffs).toBe(true);
      expect((setting().element as HTMLInputElement).checked).toBe(true);
      expect(wrapper.get('.git-diff-control__files').text()).toBe('1');
      expect(wrapper.get('.git-review-panel__added').text()).toBe('+2');
      expect(wrapper.get('.git-diff-preview-panel').text()).not.toContain('package-lock.json');
      const map = wrapper.findAll('.git-diff-view-toggle label').find(label => label.text() === 'Map')!;
      await map.get('input').setValue(true);
      expect(wrapper.getComponent(GitDiffTreemap).props('files')).toHaveLength(1);
      await setting().setValue(false);
      await flushPromises();
      expect(wrapper.get('.git-diff-control__files').text()).toBe('2');
      expect(wrapper.getComponent(GitDiffTreemap).props('files')).toHaveLength(2);
    } finally { wrapper.unmount(); }
  });
  afterEach(() => vi.restoreAllMocks());
  it('shows the selected remote provider in Git review', () => {
    const wrapper = mount(GitReviewPanel, { props: { agent: { id: 'a', folder: '/repo' } as never,
      gitStatus: { folder: '/repo', repositoryProvider: 'gitlab' } as never,
      panel: { kind: 'gitDiff', title: 'Review', diff, state: 'idle', error: null } } });
    expect(wrapper.find('svg.tabler-icon-brand-gitlab').exists()).toBe(true);
    expect(wrapper.find('svg.tabler-icon-brand-github').exists()).toBe(false);
    wrapper.unmount();
  });
  it('shows repository context, totals, and every file diff', async () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1',
          teamId: 'team-1',
          name: 'Dina',
          avatar: 'D',
          folder: '/Users/nicolas/src/agent-workspace',
          provider: 'codex',
          status: { type: 'idle' },
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        gitStatus: {
          folder: '/Users/nicolas/src/agent-workspace',
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
          changedFiles: 1,
          addedLines: 2,
          removedLines: 1,
          hasUntracked: false,
          state: 'dirty',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: { kind: 'gitDiff', title: 'Review', diff, state: 'idle', error: null },
      },
    });

    expect(wrapper.text()).toContain('agent-workspace');
    expect(wrapper.text()).toContain('main→origin/main');
    expect(wrapper.get('[aria-label="Diff statistics"]').text()).toBe('+2-1');
    expect(wrapper.text()).toContain('src/main.ts');
    expect(wrapper.text()).toContain('newValue');

    await wrapper.get('[aria-label="Refresh repository diff"]').trigger('click');
    expect(wrapper.emitted('refresh')).toStrictEqual([[]]);
  });

  it('shows statistics for the selected comparison instead of the working tree', () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1', teamId: 'team-1', name: 'Dina', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        gitStatus: {
          folder: '/repo', ahead: 0, behind: 0, changedFiles: 1, addedLines: 2, removedLines: 1, hasUntracked: false, state: 'dirty', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: {
          kind: 'gitDiff', title: 'Branch changes', diff, sections: [], state: 'idle',
          target: { type: 'branch', baseRef: 'origin/main' },
          summary: { addedLines: 12, removedLines: 5, changedFiles: 3 },
        },
      },
    });

    expect(wrapper.get('[aria-label="Diff statistics"]').text()).toBe('+12-5');
    expect(wrapper.text()).toContain('src/main.ts');
  });

  it('supports wrapping and collapsing the review from its options menu', async () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: { kind: 'gitDiff', title: 'Review', diff, state: 'idle' },
      },
    });

    await wrapper.get('[aria-label="Review options"]').trigger('click');
    await bodyAll('.app-menu__item').find((item) => item.text().includes('Word wrap'))?.trigger('click');
    expect(wrapper.get('.git-diff-preview-panel').classes()).toContain('git-diff-preview-panel--wrap');

    await wrapper.get('[aria-label="Review options"]').trigger('click');
    await bodyAll('.app-menu__item').find((item) => item.text().includes('Collapse all'))?.trigger('click');
    expect(wrapper.get('.git-diff-preview-panel__file-header').attributes('aria-expanded')).toBe('false');
  });

  it('groups files by type by default and lets the options menu turn it off', async () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: { kind: 'gitDiff', title: 'Review', diff, state: 'idle' },
      },
    });
    expect(wrapper.find('.git-diff-preview-panel__group-header').exists()).toBe(true);
    await wrapper.get('[aria-label="Review options"]').trigger('click');
    const toggle = () => bodyAll('.app-menu__item').find(item => item.text().includes('Group by file type'))!;
    expect(toggle().attributes('aria-checked')).toBe('true');
    await toggle().trigger('click');
    expect(wrapper.find('.git-diff-preview-panel__group-header').exists()).toBe(false);
    await wrapper.get('[aria-label="Review options"]').trigger('click');
    expect(toggle().attributes('aria-checked')).toBe('false');
  });

  it('shows all git scopes by default and toggles each section locally', async () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: { kind: 'gitDiff', title: 'Review', diff: scopedDiffs.map((section) => section.diff).join('\n'), sections: scopedDiffs, state: 'idle' },
      },
    });

    expect(wrapper.text()).toContain('src/staged.ts');
    expect(wrapper.text()).toContain('src/unstaged.ts');
    expect(wrapper.text()).toContain('src/untracked.ts');

    await wrapper.get('[aria-label="Review options"]').trigger('click');
    const unstaged = bodyAll('.app-menu__item').find((item) => item.text().includes('Unstaged changes'));
    expect(unstaged).toBeDefined();
    await unstaged!.trigger('click');

    expect(wrapper.text()).toContain('src/staged.ts');
    expect(wrapper.text()).not.toContain('src/unstaged.ts');
    expect(wrapper.text()).toContain('src/untracked.ts');
  });

  it('keeps staged and unstaged patches for the same file independently reviewable', () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: {
          id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
        },
        panel: {
          kind: 'gitDiff',
          title: 'Review',
          diff: `${diff}\n${diff}`,
          sections: [
            { scope: 'staged', diff },
            { scope: 'unstaged', diff },
            { scope: 'untracked', diff: '' },
          ],
          state: 'idle',
        },
      },
    });

    expect(wrapper.findAll('.git-diff-preview-panel__file')).toHaveLength(2);
  });

  it('keeps the review workspace focused on the diff', () => {
    const wrapper = mount(GitReviewPanel, {
      props: {
        agent: { id: 'agent-1', teamId: 'team-1', name: 'Dina', avatar: 'D', folder: '/repo', provider: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
        panel: { kind: 'gitDiff', title: 'Review', diff, state: 'idle' },
      },
    });

    expect(wrapper.find('.git-review-panel__workflow').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Select changes to stage');
    expect(wrapper.text()).not.toContain('Create draft PR');
  });
});
