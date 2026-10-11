import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { ElDialog, ElInput } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserBookmark } from '@workspace/core/browser-bookmarks';
import BrowserBookmarks from '../BrowserBookmarks.vue';

const page = new DOMWrapper(document.body);
afterEach(() => { document.body.innerHTML = ''; });

function mountBookmarks(bookmarks: BrowserBookmark[] = [], save = vi.fn().mockResolvedValue(undefined)) {
  return mount(BrowserBookmarks, {
    attachTo: document.body,
    props: { bookmarks, url: 'https://example.com/', title: 'Example', save },
    global: { components: { ElDialog, ElInput } },
  });
}

async function openEditor() {
  await page.get('button[aria-label="Bookmark this page"]').trigger('click');
  await flushPromises();
}

describe('BrowserBookmarks', () => {
  it('closes teleported dialogs when its agent pane becomes inactive', async () => {
    const wrapper = mountBookmarks();
    await openEditor();
    await wrapper.setProps({ active: false });
    await flushPromises();
    expect((page.get('input[aria-label="Bookmark name"]').element.closest('.el-overlay') as HTMLElement).style.display).toBe('none');
    wrapper.unmount();
  });
  it('adds the current page with an editable name and opens its editor for normalized duplicates', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountBookmarks([], save);
    await openEditor();
    expect(page.get<HTMLInputElement>('input[aria-label="Bookmark name"]').element.value).toBe('Example');
    await page.get('input[aria-label="Bookmark name"]').setValue(' Preview ');
    await page.get('form').trigger('submit');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([{ title: 'Preview', url: 'https://example.com/' }]);
    await wrapper.setProps({ bookmarks: [{ title: 'Preview', url: 'https://example.com/' }], url: 'https://EXAMPLE.com:443' });
    await page.get('button[aria-label="Edit bookmark"]').trigger('click');
    await flushPromises();
    await page.get('input[aria-label="Bookmark name"]').setValue('Renamed');
    await page.get('form').trigger('submit');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([{ title: 'Renamed', url: 'https://example.com/' }]);
    wrapper.unmount();
  });

  it('searches title and URL, opens a result, and edits or removes without navigating', async () => {
    const entries = [
      { title: 'Example', url: 'https://example.com/' },
      { title: 'Local preview', url: 'http://localhost:5173/' },
    ];
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountBookmarks(entries, save);
    await page.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    await page.get('input[aria-label="Search bookmarks"]').setValue('LOCALHOST');
    expect(page.findAll('.browser-bookmarks__open')).toHaveLength(1);
    expect(page.get('.browser-bookmarks__open').text()).toContain('Local preview');
    expect(page.get('.browser-bookmarks__open').text()).toContain('http://localhost:5173/');
    await page.get('.browser-bookmarks__open').trigger('click');
    expect(wrapper.emitted('open')).toStrictEqual([['http://localhost:5173/']]);
    await page.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    await page.get('button[aria-label="Edit Local preview"]').trigger('click');
    await flushPromises();
    await page.findAll('button').find(button => button.text() === 'Remove')!.trigger('click');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([entries[0]]);
    expect(wrapper.emitted('open')).toHaveLength(1);
    expect((page.get('input[aria-label="Search bookmarks"]').element.closest('.el-overlay') as HTMLElement).style.display).not.toBe('none');
    wrapper.unmount();
  });

  it('shows distinct empty and no-match states and supports keyboard submission', async () => {
    const wrapper = mountBookmarks();
    await page.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    expect(page.text()).toContain('No bookmarks yet');
    await wrapper.setProps({ bookmarks: [{ title: 'Preview', url: 'https://example.com/' }] });
    await page.get('input[aria-label="Search bookmarks"]').setValue('missing');
    expect(page.text()).toContain('No matching bookmarks');
    await page.get('input[aria-label="Search bookmarks"]').setValue('preview');
    await page.get('input[aria-label="Search bookmarks"]').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('open')).toStrictEqual([['https://example.com/']]);
    wrapper.unmount();
  });

  it('keeps unsaved edits visible on save failure and prevents duplicate submissions', async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const wrapper = mountBookmarks([], save);
    await openEditor();
    await page.get('input[aria-label="Bookmark name"]').setValue('');
    expect(page.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    await page.get('input[aria-label="Bookmark name"]').setValue('Preview');
    await page.get('form').trigger('submit');
    await page.get('form').trigger('submit');
    expect(save).toHaveBeenCalledTimes(1);
    reject(new Error('Storage unavailable'));
    await flushPromises();
    expect(page.get('[role="alert"]').text()).toContain('Could not save bookmarks');
    expect(page.get<HTMLInputElement>('input[aria-label="Bookmark name"]').element.value).toBe('Preview');
    wrapper.unmount();
  });

  it.each(['file:///tmp/preview.html', 'https://user:secret@example.com/', 'javascript:alert(1)', ''])('keeps the star disabled for %s', async url => {
    const wrapper = mountBookmarks();
    await wrapper.setProps({ url });
    expect(page.get<HTMLButtonElement>('button[aria-label="Bookmark this page"]').element.disabled).toBe(true);
    expect(page.find('[aria-label="Bookmarks"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
