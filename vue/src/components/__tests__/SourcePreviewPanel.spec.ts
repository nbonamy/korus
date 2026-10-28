import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SourcePreviewPanel from '../SourcePreviewPanel.vue';

describe('SourcePreviewPanel', () => {
  it('renders read-only highlighted source content', () => {
    const wrapper = mount(SourcePreviewPanel, {
      props: {
        content: 'const value: number = 42;\n',
        language: 'typescript',
      },
    });

    expect(wrapper.find('.source-preview-panel').exists()).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('pre code .line span[style]').exists()).toBe(true);
    expect(wrapper.findAll('.line')).toHaveLength(2);
    expect(wrapper.text()).toContain('value');
  });

  it('can hide line numbers', () => {
    const wrapper = mount(SourcePreviewPanel, {
      props: {
        content: 'const veryLongValueName = "this is intentionally long";\n',
        language: 'typescript',
        showLineNumbers: false,
      },
    });

    expect(wrapper.get('.source-preview-panel').classes()).toContain('source-preview-panel--hide-line-numbers');
  });

  it('applies wrapping styles to rendered source lines', () => {
    const unwrapped = mount(SourcePreviewPanel, {
      props: {
        content: 'const veryLongValueName = "this is intentionally long";\n',
        language: 'typescript',
        wordWrap: false,
      },
    });
    const wrapped = mount(SourcePreviewPanel, {
      props: {
        content: 'const veryLongValueName = "this is intentionally long";\n',
        language: 'typescript',
        wordWrap: true,
      },
    });

    expect(getComputedStyle(unwrapped.get('.line').element).whiteSpace).toBe('pre');
    expect(getComputedStyle(wrapped.get('.line').element).whiteSpace).toBe('pre-wrap');
    expect(getComputedStyle(wrapped.get('.line').element).overflowWrap).toBe('anywhere');
  });

  it('renders loading, empty, and error states', () => {
    expect(mount(SourcePreviewPanel, {
      props: { content: '', state: 'loading' },
    }).text()).toContain('Loading source...');

    expect(mount(SourcePreviewPanel, {
      props: { content: '' },
    }).text()).toContain('No source content.');

    expect(mount(SourcePreviewPanel, {
      props: { content: '', state: 'error', error: 'Cannot read file.' },
    }).text()).toContain('Cannot read file.');
  });

  describe('annotating', () => {
    const Popup = { name: 'AnnotationPopup', props: ['description', 'anchor'], emits: ['submit', 'cancel'], template: '<form class="popup" />' };
    const content = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const mountSource = (props: Record<string, unknown> = {}) => mount(SourcePreviewPanel, {
      props: { content, language: 'typescript', path: 'src/x.ts', annotatable: true, ...props },
      global: { stubs: { AnnotationPopup: Popup } },
    });
    const plusClick = async (wrapper: ReturnType<typeof mountSource>, index: number, extra: Record<string, unknown> = {}) => {
      await wrapper.findAll('.line')[index]!.get('button').trigger('click', extra);
    };

    it('numbers the rendered lines and names the file', async () => {
      const wrapper = mountSource();
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.line').map(line => line.attributes('data-code-line'))).toStrictEqual(['1', '2', '3']);
      expect(wrapper.get('.source-preview-panel__content').attributes('data-code-path')).toBe('src/x.ts');
    });

    it('opens the annotation box directly from plus and extends the range with shift', async () => {
      const wrapper = mountSource();
      await wrapper.vm.$nextTick();
      await plusClick(wrapper, 1);
      expect(wrapper.findAll('.line')[1]!.classes()).toContain('code-annotation-line--selected');
      await plusClick(wrapper, 2, { shiftKey: true });
      expect(wrapper.getComponent(Popup).props('description')).toBe('src/x.ts lines 2-3');
      wrapper.getComponent(Popup).vm.$emit('submit', 'Use let.');
      expect(wrapper.emitted('annotate')).toStrictEqual([[{ path: 'src/x.ts', startLine: 2, endLine: 3, text: 'const b = 2;\nconst c = 3;', comment: 'Use let.' }]]);
    });

    it('annotates a range dragged down the gutter', async () => {
      const wrapper = mountSource();
      await wrapper.vm.$nextTick();
      await wrapper.findAll('.line')[0]!.get('button').trigger('mousedown');
      expect(wrapper.findComponent(Popup).exists()).toBe(false);
      wrapper.findAll('.line')[2]!.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await wrapper.vm.$nextTick();
      expect(wrapper.getComponent(Popup).props('description')).toBe('src/x.ts lines 1-3');
    });

    it('ignores clicks on the code itself, and offers nothing without a path or when annotating is off', async () => {
      const wrapper = mountSource();
      await wrapper.vm.$nextTick();
      for (const clientX of [10, 200]) {
        await wrapper.findAll('.line')[0]!.trigger('mousedown', { clientX });
        wrapper.findAll('.line')[2]!.element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await wrapper.vm.$nextTick();
        expect(wrapper.findComponent(Popup).exists()).toBe(false);
        expect(wrapper.find('.code-annotation-line--selected').exists()).toBe(false);
      }
      for (const props of [{ path: undefined }, { annotatable: false }]) {
        const other = mountSource(props);
        await other.vm.$nextTick();
        expect(other.find('.line button').exists()).toBe(false);
        expect(other.find('.code-selection-annotation__add').exists()).toBe(false);
      }
    });

    it('forgets the selection when another file is shown', async () => {
      const wrapper = mountSource();
      await wrapper.vm.$nextTick();
      await plusClick(wrapper, 0);
      expect(wrapper.findComponent(Popup).exists()).toBe(true);
      await wrapper.setProps({ content: 'let z;', path: 'src/z.ts' });
      expect(wrapper.find('.code-selection-annotation__add').exists()).toBe(false);
    });
  });
});
