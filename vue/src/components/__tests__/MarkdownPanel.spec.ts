import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownPanel from '../MarkdownPanel.vue';

afterEach(() => vi.restoreAllMocks());

async function mountDocument(content: string, attachTo?: HTMLElement) {
  const wrapper = mount(MarkdownPanel, { attachTo, props: { content, outlineEnabled: true } });
  await nextTick();
  return wrapper;
}

describe('MarkdownPanel', () => {
  it('renders markdown using the shared markdown surface', () => {
    const wrapper = mount(MarkdownPanel, {
      props: {
        content: '# Notes\n\n[Read docs](docs/architecture.md)\n\n```ts\nconst ok = true\n```',
      },
    });

    expect(wrapper.get('.markdown-panel__content').classes()).toContain('codex-markdown');
    expect(wrapper.get('h1').text()).toBe('Notes');
    expect(wrapper.get('a').attributes('href')).toBe('docs/architecture.md');
    expect(wrapper.text()).toContain('const ok = true');
    expect(wrapper.find('[aria-expanded]').exists()).toBe(false);
  });

  it('builds an optional hierarchy from rendered headings, excluding code and unsafe markup', async () => {
    const wrapper = await mountDocument([
      '# **Notes** & `tips`',
      '### [Detail](docs/architecture.md)',
      '## Notes',
      '## Notes',
      '## Notes-2',
      '#',
      '# ![Diagram](diagram.png)',
      '```md\n# Not a heading\n```',
      '    # Neither is this',
      '<h1 onclick="alert(1)">Raw HTML</h1>',
      '## [Unsafe](javascript:alert(1))',
    ].join('\n\n'));

    const toggle = wrapper.get('button[aria-expanded]');
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('nav').exists()).toBe(false);
    await toggle.trigger('click');
    const rows = wrapper.findAll('nav button');
    expect(rows.map(row => row.text())).toStrictEqual(['Notes & tips', 'Detail', 'Notes', 'Notes', 'Notes-2', 'Diagram', 'Unsafe']);
    expect(rows.map(row => row.attributes('aria-label'))).toStrictEqual([
      'Notes & tips (heading level 1)', 'Detail (heading level 3)', 'Notes (heading level 2)',
      'Notes (heading level 2)', 'Notes-2 (heading level 2)', 'Diagram (heading level 1)', 'Unsafe (heading level 2)',
    ]);
    const anchors = wrapper.findAll('h1,h2,h3').map(heading => heading.attributes('id')).filter(Boolean);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(wrapper.get('.markdown-panel__content a').attributes('href')).toBe('docs/architecture.md');
    expect(wrapper.find('[onclick]').exists()).toBe(false);
    expect(wrapper.find('[href^="javascript:"]').exists()).toBe(false);
    await toggle.trigger('click');
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.get('h1 strong').text()).toBe('Notes');
  });

  it('keeps the full label available when a long outline row is truncated', async () => {
    const wrapper = await mountDocument('# Guide\n\n## A long section title');
    await wrapper.get('button[aria-expanded]').trigger('click');
    const row = wrapper.findAll('nav button')[1];
    expect(row.attributes('title')).toBe('A long section title');
    expect(row.attributes('aria-label')).toBe('A long section title (heading level 2)');
    expect(getComputedStyle(row.element).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(row.element).whiteSpace).toBe('nowrap');
  });

  it('uses quieter weights for deeper headings and emphasizes the active section', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    try {
      const wrapper = await mountDocument('# Guide\n\n## Setup\n\n### Details', host);
      await wrapper.get('button[aria-expanded]').trigger('click');
      const rows = wrapper.findAll('nav button');
      Object.defineProperty(wrapper.get('.markdown-panel__document').element, 'scrollTo', { configurable: true, value: vi.fn() });
      await rows[0].trigger('click');
      expect(getComputedStyle(rows[0].element).fontWeight).toBe('var(--font-weight-bold)');
      expect(getComputedStyle(rows[1].element).fontWeight).toBe('var(--font-weight-semibold)');
      expect(getComputedStyle(rows[2].element).fontWeight).toBe('var(--font-weight-regular)');
      await rows[1].trigger('click');
      expect(rows[1].attributes('aria-current')).toBe('location');
      expect(getComputedStyle(rows[1].element).fontWeight).toBe('var(--font-weight-semibold)');
      expect(getComputedStyle(rows[0].element).fontWeight).toBe('var(--font-weight-bold)');
      expect(getComputedStyle(rows[2].element).fontWeight).toBe('var(--font-weight-regular)');
    } finally {
      host.remove();
    }
  });

  it('offers the outline through a compact floating icon control', async () => {
    const wrapper = await mountDocument('# Guide');
    const toggle = wrapper.get('button[aria-expanded]');
    expect(toggle.attributes('aria-label')).toBe('Outline');
    expect(toggle.attributes('title')).toBe('Outline');
    expect(toggle.text()).toBe('Outline');
    expect(toggle.find('svg').exists()).toBe(true);
    expect(getComputedStyle(toggle.element).position).toBe('absolute');
    await toggle.trigger('click');
    expect(wrapper.find('nav').exists()).toBe(true);
  });

  it('navigates duplicate headings within its own scroll pane and tracks manual scrolling', async () => {
    const pair = mount({
      components: { MarkdownPanel },
      template: '<MarkdownPanel content="# Start\n\n## Repeat\n\n## Repeat" outline-enabled /><MarkdownPanel content="# Start\n\n## Repeat" outline-enabled />',
    });
    await nextTick();
    const [wrapper, other] = pair.findAllComponents(MarkdownPanel);
    await wrapper.get('button[aria-expanded]').trigger('click');
    const viewport = wrapper.get('.markdown-panel__document').element as HTMLElement;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 650 },
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 40 } as DOMRect);
    wrapper.findAll('h1,h2').forEach((heading, index) => {
      vi.spyOn(heading.element, 'getBoundingClientRect').mockImplementation(() => ({ top: 48 + index * 300 - viewport.scrollTop } as DOMRect));
    });
    const scrollTo = vi.fn((options: ScrollToOptions) => { viewport.scrollTop = options.top ?? 0; });
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo });
    await wrapper.get('.markdown-panel__document').trigger('scroll');
    const rows = wrapper.findAll('nav button');
    expect(rows[0].attributes('aria-current')).toBe('location');
    await rows[2].trigger('click');
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'auto' });
    expect(rows[2].attributes('aria-current')).toBe('location');
    expect((other.get('.markdown-panel__document').element as HTMLElement).scrollTop).toBe(0);
    expect(other.get('h1').attributes('id')).not.toBe(wrapper.get('h1').attributes('id'));

    viewport.scrollTop = 320;
    await wrapper.get('.markdown-panel__document').trigger('scroll');
    expect(rows[1].attributes('aria-current')).toBe('location');
    expect(rows[2].attributes('aria-current')).toBeUndefined();
    viewport.scrollTop = 550;
    await wrapper.get('.markdown-panel__document').trigger('scroll');
    expect(rows[2].attributes('aria-current')).toBe('location');
  });

  it('replaces outline targets and removes controls for empty, loading and error documents', async () => {
    const wrapper = await mountDocument('# Old');
    await wrapper.get('button[aria-expanded]').trigger('click');
    await wrapper.setProps({ content: '## New\n\n### Child' });
    expect(wrapper.findAll('nav button').map(row => row.text())).toStrictEqual(['New', 'Child']);
    expect(wrapper.find('h1').exists()).toBe(false);
    const scrollTo = vi.fn();
    Object.defineProperty(wrapper.get('.markdown-panel__document').element, 'scrollTo', { configurable: true, value: scrollTo });
    vi.spyOn(wrapper.get('h3').element, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
    await wrapper.findAll('nav button')[1].trigger('click');
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 192, behavior: 'auto' });
    for (const props of [{ content: '#\n\n##' }, { content: 'No headings' }, { content: ' ' }, { content: '# Hidden', state: 'loading' as const }, { state: 'error' as const }]) {
      await wrapper.setProps(props);
      expect(wrapper.find('nav').exists()).toBe(false);
      expect(wrapper.find('button[aria-expanded]').exists()).toBe(false);
    }
    await wrapper.setProps({ content: '# Back', state: 'idle' });
    expect(wrapper.get('button[aria-expanded]').attributes('aria-expanded')).toBe('false');
  });

  it('disconnects layout tracking on replacement and unmount', async () => {
    const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
    });
    const wrapper = await mountDocument('# First\n\n## Second');
    await wrapper.get('button[aria-expanded]').trigger('click');
    const viewport = wrapper.get('.markdown-panel__document').element;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
    vi.spyOn(wrapper.get('h1').element, 'getBoundingClientRect').mockReturnValue({ top: -200 } as DOMRect);
    vi.spyOn(wrapper.get('h2').element, 'getBoundingClientRect').mockReturnValue({ top: 12 } as DOMRect);
    observers[0].callback([], {} as ResizeObserver);
    await nextTick();
    expect(wrapper.findAll('nav button')[1].attributes('aria-current')).toBe('location');
    await wrapper.setProps({ content: '# Replacement' });
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  });

  it('preserves a native text selection when expanding and collapsing the outline', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const wrapper = mount(MarkdownPanel, { attachTo: host, props: { content: '# Notes\n\nSelect **formatted** text.', outlineEnabled: true } });
    try {
      await nextTick();
      const range = document.createRange();
      range.selectNodeContents(wrapper.get('.markdown-panel__content p').element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const toggle = wrapper.get('button[aria-expanded]');
      await toggle.trigger('click');
      expect(selection.toString()).toBe('Select formatted text.');
      await toggle.trigger('click');
      expect(selection.toString()).toBe('Select formatted text.');
      selection.removeAllRanges();
    } finally {
      wrapper.unmount();
      host.remove();
    }
  });

  it('shows loading and error states', async () => {
    const loadingWrapper = mount(MarkdownPanel, {
      props: {
        content: '',
        state: 'loading',
      },
    });

    expect(loadingWrapper.text()).toContain('Loading markdown...');

    const errorWrapper = mount(MarkdownPanel, {
      props: {
        content: '',
        state: 'error',
        error: 'Could not read README.md',
      },
    });

    expect(errorWrapper.text()).toContain('Could not read README.md');
  });

  it('shows default error and empty states', () => {
    const errorWrapper = mount(MarkdownPanel, {
      props: {
        content: '',
        state: 'error',
      },
    });

    expect(errorWrapper.text()).toContain('Unable to load markdown.');

    const emptyWrapper = mount(MarkdownPanel, {
      props: {
        content: '   ',
      },
    });

    expect(emptyWrapper.text()).toContain('No markdown content.');
  });
});
