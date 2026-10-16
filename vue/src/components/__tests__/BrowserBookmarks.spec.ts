import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { ElDialog, ElInput, ElMessage } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserBookmark } from '@workspace/core/browser-bookmarks';
import BrowserBookmarks from '../BrowserBookmarks.vue';

const page = new DOMWrapper(document.body);
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

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
  it('adds a named page and deletes a normalized existing bookmark directly from its star', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountBookmarks([], save);
    await openEditor();
    expect(page.get<HTMLInputElement>('input[aria-label="Bookmark name"]').element.value).toBe('Example');
    await page.get('input[aria-label="Bookmark name"]').setValue(' Preview ');
    await page.get('form').trigger('submit');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([{ title: 'Preview', url: 'https://example.com/' }]);
    await wrapper.setProps({ bookmarks: [{ title: 'Preview', url: 'https://example.com/' }], url: 'https://EXAMPLE.com:443' });
    await page.get('button[aria-label="Delete Preview"]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([]);
    expect(page.findAll('.el-overlay').every(overlay => (overlay.element as HTMLElement).style.display === 'none')).toBe(true);
    await wrapper.setProps({ bookmarks: [] });
    expect(page.get('button[aria-label="Bookmark this page"]').attributes('aria-pressed')).toBe('false');
    wrapper.unmount();
  });

  it('disables the star during deletion and reports failure without losing the bookmark', async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: vi.fn() }));
    const bookmark = { title: 'Example', url: 'https://example.com/' };
    const wrapper = mountBookmarks([bookmark], save);
    const star = page.get<HTMLButtonElement>('button[aria-label="Delete Example"]');
    await star.trigger('click');
    expect(star.element.disabled).toBe(true);
    await star.trigger('click');
    expect(save).toHaveBeenCalledExactlyOnceWith([]);
    reject(new Error('Storage unavailable'));
    await flushPromises();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not save bookmarks'));
    expect(star.attributes('aria-pressed')).toBe('true');
    expect(star.element.disabled).toBe(false);
    expect(page.findAll('.el-overlay').every(overlay => (overlay.element as HTMLElement).style.display === 'none')).toBe(true);
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
    expect(page.findAll('.quick-open-dialog__item')).toHaveLength(1);
    expect(page.get('.quick-open-dialog__item').text()).toContain('Local preview');
    expect(page.get('.quick-open-dialog__item').text()).toContain('http://localhost:5173/');
    await page.get('.quick-open-dialog__item').trigger('click');
    expect(wrapper.emitted('open')).toStrictEqual([['http://localhost:5173/']]);
    await page.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    await page.get('button[aria-label="Delete Local preview"]').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([entries[0]]);
    expect(wrapper.emitted('open')).toHaveLength(1);
    expect(page.find('input[aria-label="Search bookmarks"]').exists()).toBe(true);
    await wrapper.setProps({ bookmarks: [entries[0]!] });
    await page.get('button[aria-label="Edit Example"]').trigger('click');
    await flushPromises();
    await page.get('input[aria-label="Bookmark name"]').setValue('Renamed example');
    await page.get('form').trigger('submit');
    await flushPromises();
    expect(save).toHaveBeenLastCalledWith([{ title: 'Renamed example', url: 'https://example.com/' }]);
    expect(page.find('input[aria-label="Search bookmarks"]').exists()).toBe(true);
    await page.get('input[aria-label="Search bookmarks"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(document.activeElement).toBe(page.get('button[aria-label="Bookmarks"]').element);
    wrapper.unmount();
  });

  it('keeps the picker and bookmark intact when deleting fails, and prevents repeated pending deletes', async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const wrapper = mountBookmarks([{ title: 'Example', url: 'https://example.com/' }], save);
    await page.get('[aria-label="Bookmarks"]').trigger('click');
    await flushPromises();
    await page.get('button[aria-label="Delete Example"]').trigger('click');
    expect(page.get<HTMLButtonElement>('button[aria-label="Delete Example"]').element.disabled).toBe(true);
    await page.get('button[aria-label="Delete Example"]').trigger('click');
    expect(save).toHaveBeenCalledExactlyOnceWith([]);
    reject(new Error('Storage unavailable'));
    await flushPromises();
    expect(page.get('[role="alert"]').text()).toContain('Could not save bookmarks');
    expect(page.get('.quick-open-dialog__item').text()).toContain('Example');
    expect(wrapper.emitted('open')).toBeUndefined();
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
