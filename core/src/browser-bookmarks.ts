export type BrowserBookmark = { title: string; url: string };

/** Bookmarks accept explicit web URLs only; credentials must never be persisted. */
export function bookmarkUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeBrowserBookmarks(value: unknown): BrowserBookmark[] {
  if (!Array.isArray(value)) return [];
  const bookmarks = new Map<string, BrowserBookmark>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string' || typeof entry.url !== 'string') continue;
    const url = bookmarkUrl(entry.url);
    const title = entry.title.trim();
    if (url && title && !bookmarks.has(url)) bookmarks.set(url, { title, url });
  }
  return [...bookmarks.values()];
}
