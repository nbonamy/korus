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
});
