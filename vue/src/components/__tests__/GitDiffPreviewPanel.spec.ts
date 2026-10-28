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

    it('opens only the requested group once its diff is loaded, and again for each new request', async () => {
      const wrapper = mount(GitDiffPreviewPanel, { props: { diff: '', groupByKind: true, focusKind: 'test', focusSequence: 1 } });
      await wrapper.setProps({ diff });
      const expanded = () => wrapper.findAll('.git-diff-preview-panel__group-header').filter(header => header.attributes('aria-expanded') === 'true').map(header => header.text().replace(/\d.*/, ''));
      expect(expanded()).toStrictEqual(['Tests']);
      expect(wrapper.findAll('.git-diff-preview-panel__file-title strong').map(name => name.text())).toStrictEqual(['app.test.ts']);
      await wrapper.setProps({ diff: `${diff}\n${fileDiff('src/new.ts')}` });
      await wrapper.findAll('.git-diff-preview-panel__group-header').find(header => header.text().startsWith('Code'))!.trigger('click');
      expect(expanded()).toStrictEqual(['Code', 'Tests']);
      await wrapper.setProps({ focusKind: 'docs', focusSequence: 2 });
      expect(expanded()).toStrictEqual(['Documentation']);
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

describe('annotating a diff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,3 +1,3 @@',
    ' keep', '-old', '+new', ' tail',
    'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1 +1 @@', '-b1', '+b2',
  ].join('\n');
  const Popup = { name: 'AnnotationPopup', props: ['description', 'anchor'], emits: ['submit', 'cancel'], template: '<form class="popup" />' };
  const mountPanel = (annotatable = true) => mount(GitDiffPreviewPanel, { props: { diff, annotatable }, global: { stubs: { AnnotationPopup: Popup } } });
  const rows = (wrapper: ReturnType<typeof mountPanel>) => wrapper.findAll('.git-diff-preview-panel__line');
  const plus = (row: ReturnType<typeof rows>[number]) => row.get('.git-diff-preview-panel__annotate');

  it('marks each line with its file and number, on the side the line belongs to', () => {
    const lines = rows(mountPanel()).map(row => [row.attributes('data-code-line'), row.attributes('data-code-side'), row.attributes('data-code-prefix')]);
    expect(lines).toStrictEqual([['1', 'new', ' '], ['2', 'old', '-'], ['2', 'new', '+'], ['3', 'new', ' '], ['1', 'old', '-'], ['1', 'new', '+']]);
    expect(mountPanel().findAll('[data-code-path]').map(file => file.attributes('data-code-path'))).toStrictEqual(['src/a.ts', 'src/b.ts']);
  });

  it('opens the annotation box directly from plus, quoting the line with its marker', async () => {
    const wrapper = mountPanel();
    await plus(rows(wrapper)[2]!).trigger('click');
    expect(rows(wrapper)[2]!.classes()).toContain('code-annotation-line--selected');
    wrapper.getComponent(Popup).vm.$emit('submit', 'Rename for clarity.');
    expect(wrapper.emitted('annotate')).toStrictEqual([[{ path: 'src/a.ts', startLine: 2, endLine: 2, side: 'new', text: '+new', comment: 'Rename for clarity.' }]]);
  });

  it('shows a plus in the margin of each line that can be annotated, and it picks that line', async () => {
    const wrapper = mountPanel();
    expect(wrapper.findAll('.git-diff-preview-panel__annotate')).toHaveLength(6);
    expect(mountPanel(false).findAll('.git-diff-preview-panel__annotate')).toHaveLength(0);
    await rows(wrapper)[0]!.get('.git-diff-preview-panel__line-number').trigger('mousedown');
    rows(wrapper)[3]!.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(Popup).exists()).toBe(false);
    expect(wrapper.find('.code-annotation-line--selected').exists()).toBe(false);
    await rows(wrapper)[1]!.get('.git-diff-preview-panel__annotate').trigger('click');
    expect(wrapper.findComponent(Popup).exists()).toBe(true);
    await rows(wrapper)[3]!.get('.git-diff-preview-panel__annotate').trigger('click', { shiftKey: true });
    wrapper.getComponent(Popup).vm.$emit('submit', 'Hunk.');
    expect(wrapper.emitted('annotate')![0]![0]).toMatchObject({ startLine: 2, endLine: 3, text: '-old\n+new\n tail' });
  });

  it('annotates a range with shift, including the removed lines it covers', async () => {
    const wrapper = mountPanel();
    await plus(rows(wrapper)[0]!).trigger('click');
    await plus(rows(wrapper)[3]!).trigger('click', { shiftKey: true });
    wrapper.getComponent(Popup).vm.$emit('submit', 'Whole hunk.');
    expect(wrapper.emitted('annotate')![0]![0]).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 3, side: 'new', text: ' keep\n-old\n+new\n tail' });
  });

  it('opens the annotation box when a drag from plus ends', async () => {
    const wrapper = mountPanel();
    await plus(rows(wrapper)[0]!).trigger('mousedown');
    expect(wrapper.findComponent(Popup).exists()).toBe(false);
    rows(wrapper)[3]!.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(rows(wrapper).map(row => row.classes().includes('code-annotation-line--selected'))).toStrictEqual([true, true, true, true, false, false]);
    wrapper.getComponent(Popup).vm.$emit('submit', 'Whole hunk.');
    expect(wrapper.emitted('annotate')![0]![0]).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 3, text: ' keep\n-old\n+new\n tail' });
  });

  it('numbers a removed line by the old file', async () => {
    const wrapper = mountPanel();
    await plus(rows(wrapper)[4]!).trigger('click');
    wrapper.getComponent(Popup).vm.$emit('submit', 'Why remove?');
    expect(wrapper.emitted('annotate')![0]![0]).toMatchObject({ path: 'src/b.ts', startLine: 1, endLine: 1, side: 'old', text: '-b1' });
  });

  it('forgets the selection when the diff is replaced, and offers nothing unless annotating is on', async () => {
    const wrapper = mountPanel();
    await plus(rows(wrapper)[1]!).trigger('click');
    expect(wrapper.findComponent(Popup).exists()).toBe(true);
    await wrapper.setProps({ diff: diff.replace('new', 'newer') });
    expect(wrapper.find('.code-selection-annotation__add').exists()).toBe(false);
    const plain = mountPanel(false);
    await rows(plain)[1]!.get('.git-diff-preview-panel__line-number').trigger('mousedown');
    expect(plain.find('.code-selection-annotation__add').exists()).toBe(false);
  });
});
