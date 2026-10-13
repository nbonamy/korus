import { describe, expect, it } from 'vitest';
import { bookmarkUrl, normalizeBrowserBookmarks } from '../browser-bookmarks';

describe('browser bookmarks', () => {
  it('normalizes HTTP preview URLs, retaining paths, queries and fragments', () => {
    expect(bookmarkUrl(' HTTP://LOCALHOST:5173/preview?q=test#section ')).toBe('http://localhost:5173/preview?q=test#section');
    expect(bookmarkUrl('https://EXAMPLE.com:443')).toBe('https://example.com/');
  });

  it.each(['', 'example.com', 'not a URL', 'javascript:alert(1)', 'data:text/html,test', 'file:///tmp/preview.html', 'about:blank', 'https://user:password@example.com/', 'https://user@example.com/'])('rejects unsupported or credential-bearing URL %s', (url) => {
    expect(bookmarkUrl(url)).toBeNull();
  });

  it('restores valid entries, trims names and keeps the first entry for a duplicate URL', () => {
    expect(normalizeBrowserBookmarks([
      { title: ' Preview ', url: 'https://EXAMPLE.com:443' },
      { title: 'Duplicate', url: 'https://example.com/' },
      { title: 'Unsafe', url: 'https://user:secret@example.com/' },
      { title: '', url: 'http://localhost:5173/' },
      null, { title: 'Invalid', url: 42 },
    ])).toStrictEqual([{ title: 'Preview', url: 'https://example.com/' }]);
    expect(normalizeBrowserBookmarks(undefined)).toStrictEqual([]);
  });
});
