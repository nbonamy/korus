import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { AgentDirectoryInput, AgentDirectoryPage } from '@workspace/core/contracts/workspace';
import FileExplorerPanel from '../FileExplorerPanel.vue';

describe('FileExplorerPanel', () => {
  const root: AgentDirectoryPage = { entries: [
    { kind: 'folder', name: 'src', path: 'src' },
    { kind: 'file', name: 'README.md', path: 'README.md' },
  ], nextCursor: null };

  it('lists folders before files, browses nested folders, searches paths, and previews files', async () => {
    const loadDirectory = vi.fn(async (input: AgentDirectoryInput = {}): Promise<AgentDirectoryPage> => {
      if (input.query) return { entries: [{ kind: 'file', name: 'button.ts', path: 'src/components/button.ts' }], nextCursor: null };
      if (input.path === 'src') return { entries: [
        { kind: 'folder', name: 'components', path: 'src/components' },
        { kind: 'file', name: 'main.ts', path: 'src/main.ts' },
      ], nextCursor: null };
      return root;
    });
    const wrapper = mount(FileExplorerPanel, { props: { loadDirectory } });
    await flushPromises();
    expect(loadDirectory).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('.file-explorer__item').map((item) => item.text())).toStrictEqual(['src', 'README.md']);
    expect(wrapper.text()).toContain('src');
    expect(wrapper.text()).not.toContain('main.ts');

    await wrapper.find('.file-explorer__folder').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('main.ts');
    expect(wrapper.findAll('.file-explorer__item').map((item) => item.text())).toStrictEqual([
      'src', 'components', 'main.ts', 'README.md',
    ]);
    await wrapper.find('button[title="Preview src/main.ts"]').trigger('click');
    expect(wrapper.emitted('preview')).toStrictEqual([['src/main.ts']]);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Add to prompt');

    await wrapper.find('input[type="search"]').setValue('button');
    await vi.waitFor(() => expect(wrapper.text()).toContain('button.ts'));
    expect(wrapper.text()).not.toContain('README.md');
    expect(loadDirectory).toHaveBeenLastCalledWith({ query: 'button' });
    expect(wrapper.find('button[title="Preview src/components/button.ts"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('paginates folders, caches expansions, and refreshes newly created files', async () => {
    const loadDirectory = vi.fn<(_: AgentDirectoryInput) => Promise<AgentDirectoryPage>>()
      .mockResolvedValueOnce({ entries: [{ kind: 'folder', name: 'empty', path: 'empty' }], nextCursor: 250 })
      .mockResolvedValueOnce({ entries: [{ kind: 'folder', name: 'pensieve', path: 'pensieve' }], nextCursor: null })
      .mockResolvedValueOnce({ entries: [], nextCursor: null });
    const wrapper = mount(FileExplorerPanel, { props: { loadDirectory } });
    await flushPromises();
    await wrapper.find('button[aria-label="Load more files"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('pensieve');
    expect(loadDirectory).toHaveBeenLastCalledWith({ path: '', cursor: 250 });
    await wrapper.find('.file-explorer__folder').trigger('click');
    await flushPromises();
    await wrapper.find('.file-explorer__folder').trigger('click');
    await wrapper.find('.file-explorer__folder').trigger('click');
    expect(loadDirectory).toHaveBeenCalledTimes(3);
    loadDirectory.mockImplementation(async input => input.path === 'empty'
      ? { entries: [{ kind: 'file', name: 'new-plan.md', path: 'empty/new-plan.md' }], nextCursor: null }
      : { entries: [{ kind: 'folder', name: 'empty', path: 'empty' }], nextCursor: null });
    await wrapper.find('button[aria-label="Refresh files"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('new-plan.md');
    wrapper.unmount();
  });

  it('renders loading, empty, and error states with retry', async () => {
    const loadDirectory = vi.fn().mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue({ entries: [], nextCursor: null });
    const wrapper = mount(FileExplorerPanel, { props: { loadDirectory } });
    expect(wrapper.text()).toContain('Loading files');
    await flushPromises();
    expect(wrapper.text()).toContain('Unavailable');
    await wrapper.find('button[aria-label="Refresh files"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('No files');
    wrapper.unmount();
  });
});
