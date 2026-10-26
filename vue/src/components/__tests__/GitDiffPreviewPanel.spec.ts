import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GitDiffPreviewPanel from '../GitDiffPreviewPanel.vue';

describe('GitDiffPreviewPanel', () => {
  it('renders multiple files, hunks, line numbers, and line states', () => {
    const wrapper = mount(GitDiffPreviewPanel, {
      props: {
        diff: [
          'diff --git a/android/music/src/main/res/values/a.ts b/android/music/src/main/res/values/a.ts',
          '--- a/android/music/src/main/res/values/a.ts',
          '+++ b/android/music/src/main/res/values/a.ts',
          '@@ -8,3 +8,4 @@ function demo',
          ' const shared = true;',
          '-const oldValue = 1;',
          '+const newValue = 2;',
          '+const added = 3;',
          'diff --git a/src/b.ts b/src/b.ts',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/b.ts',
          '@@ -0,0 +1 @@',
          '+export const created = true;',
        ].join('\n'),
      },
    });

    const files = wrapper.findAll('.git-diff-preview-panel__file');
    expect(files).toHaveLength(2);
    expect(wrapper.text()).toContain('…/src/main/res/values/a.ts');
    expect(wrapper.text()).toContain('src/b.ts');
    expect(files[0]?.get('.git-diff-preview-panel__file-directory').text()).toBe('…/src/main/res/values/');
    expect(files[0]?.get('.git-diff-preview-panel__file-title strong').text()).toBe('a.ts');
    expect(files[0]?.get('.git-diff-preview-panel__file-title').attributes('title')).toBe('android/music/src/main/res/values/a.ts');
    expect(files[0]?.find('.git-diff-preview-panel__file-icon--typescript').exists()).toBe(true);
    expect(files[0]?.find('.git-diff-preview-panel__file-meta').text()).toBe('+2-1');
    expect(files[1]?.find('.git-diff-preview-panel__file-meta').text()).toBe('+1-0');
    expect(wrapper.text()).toContain('7 unmodified lines');
    expect(wrapper.text()).not.toContain('@@');
    expect(wrapper.findAll('.git-diff-preview-panel__line--added')).toHaveLength(3);
    expect(wrapper.findAll('.git-diff-preview-panel__line--deleted')).toHaveLength(1);
    expect(wrapper.findAll('.git-diff-preview-panel__line--context')).toHaveLength(1);
    expect(wrapper.text()).toContain('newValue');
    expect(wrapper.text()).toContain('oldValue');
  });

  describe('grouping by file type', () => {
    const fileDiff = (path: string, added = 1) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -0,0 +1 @@', ...Array.from({ length: added }, () => '+line')].join('\n');
    const diff = [fileDiff('README.md'), fileDiff('src/app.test.ts', 2), fileDiff('package-lock.json'), fileDiff('src/app.ts', 3), fileDiff('src/util.ts')].join('\n');

    it('puts files under code, tests, documentation and other headers, in that order, with each group total', () => {
      const wrapper = mount(GitDiffPreviewPanel, { props: { diff, groupByKind: true } });
      const groups = wrapper.findAll('.git-diff-preview-panel__group');
      expect(groups.map(group => group.get('.git-diff-preview-panel__group-header').text())).toStrictEqual([
        'Code2 files+4-0', 'Tests1 file+2-0', 'Documentation1 file+1-0', 'Other1 file+1-0',
      ]);
      expect(groups.map(group => group.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text()))).toStrictEqual([
        ['app.ts', 'util.ts'], ['app.test.ts'], ['README.md'], ['package-lock.json'],
      ]);
    });

    it('folds and unfolds a group from its header, keeping its totals and the other groups open', async () => {
      const wrapper = mount(GitDiffPreviewPanel, { props: { diff, groupByKind: true } });
      const header = (label: string) => wrapper.findAll('.git-diff-preview-panel__group-header').find(candidate => candidate.text().startsWith(label))!;
      const names = () => wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text());
      expect(header('Tests').attributes('aria-expanded')).toBe('true');
      await header('Code').trigger('click');
      expect(header('Code').attributes('aria-expanded')).toBe('false');
      expect(header('Code').text()).toContain('2 files');
      expect(header('Code').text()).toContain('+4-0');
      expect(names()).toStrictEqual(['app.test.ts', 'README.md', 'package-lock.json']);
      await header('Code').trigger('click');
      expect(names()).toStrictEqual(['app.ts', 'util.ts', 'app.test.ts', 'README.md', 'package-lock.json']);
    });

    it('keeps a folded group folded when the diff reloads, and "expand all" opens groups and files', async () => {
      const wrapper = mount(GitDiffPreviewPanel, { props: { diff, groupByKind: true } });
      const header = (label: string) => wrapper.findAll('.git-diff-preview-panel__group-header').find(candidate => candidate.text().startsWith(label))!;
      await header('Documentation').trigger('click');
      await wrapper.setProps({ diff: `${diff}\n${fileDiff('src/new.ts')}` });
      expect(header('Documentation').attributes('aria-expanded')).toBe('false');
      expect(wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).not.toContain('README.md');
      await wrapper.setProps({ expandAllSignal: 1 });
      expect(header('Documentation').attributes('aria-expanded')).toBe('true');
      expect(wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).toContain('README.md');
    });

    it('lists the files in diff order without headers when grouping is off, and skips empty groups', () => {
      const flat = mount(GitDiffPreviewPanel, { props: { diff } });
      expect(flat.find('.git-diff-preview-panel__group-header').exists()).toBe(false);
      expect(flat.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).toStrictEqual(['README.md', 'app.test.ts', 'package-lock.json', 'app.ts', 'util.ts']);
      const codeOnly = mount(GitDiffPreviewPanel, { props: { diff: fileDiff('src/app.ts'), groupByKind: true } });
      expect(codeOnly.findAll('.git-diff-preview-panel__group-header')).toHaveLength(1);
    });
  });

  it('folds file sections from the file header', async () => {
    const wrapper = mount(GitDiffPreviewPanel, {
      props: {
        diff: [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1 @@',
          '-const oldValue = 1;',
          '+const newValue = 2;',
        ].join('\n'),
      },
    });

    const header = wrapper.get('.git-diff-preview-panel__file-header');
    expect(header.attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).toContain('oldValue');

    await header.trigger('click');

    expect(header.attributes('aria-expanded')).toBe('false');
    expect(wrapper.text()).not.toContain('oldValue');
  });

  it('supports external expand/collapse all signals and word wrap', async () => {
    const wrapper = mount(GitDiffPreviewPanel, {
      props: {
        diff: [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1 @@',
          '-const oldValue = 1;',
          '+const newValue = 2;',
        ].join('\n'),
        collapseAllSignal: 0,
        expandAllSignal: 0,
        wordWrap: true,
      },
    });

    expect(wrapper.get('.git-diff-preview-panel').classes()).toContain('git-diff-preview-panel--wrap');
    expect(wrapper.emitted('allExpandedChange')?.at(-1)).toStrictEqual([true]);

    const setSignalProps = wrapper.setProps.bind(wrapper) as unknown as (props: {
      collapseAllSignal?: number;
      expandAllSignal?: number;
    }) => Promise<void>;

    await setSignalProps({ collapseAllSignal: 1 });

    expect(wrapper.get('.git-diff-preview-panel__file-header').attributes('aria-expanded')).toBe('false');
    expect(wrapper.emitted('allExpandedChange')?.at(-1)).toStrictEqual([false]);

    await setSignalProps({ expandAllSignal: 1 });

    expect(wrapper.get('.git-diff-preview-panel__file-header').attributes('aria-expanded')).toBe('true');
    expect(wrapper.emitted('allExpandedChange')?.at(-1)).toStrictEqual([true]);
  });


  it('renders empty, loading, and error states', () => {
    expect(mount(GitDiffPreviewPanel, {
      props: { diff: '' },
    }).text()).toContain('No diff content.');

    expect(mount(GitDiffPreviewPanel, {
      props: { diff: '', state: 'loading' },
    }).text()).toContain('Loading diff...');

    expect(mount(GitDiffPreviewPanel, {
      props: { diff: '', state: 'error', error: 'No git data.' },
    }).text()).toContain('No git data.');

    expect(mount(GitDiffPreviewPanel, {
      props: { diff: 'not a git diff' },
    }).text()).toContain('No diff content.');
  });
});
