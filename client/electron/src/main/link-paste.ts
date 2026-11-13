import type { AppShortcutInput } from './app-shortcuts';

type LinkClipboard = { readText(): string; readBookmark(): { url: string } };

/**
 * Chromium pastes only the plain-text type. A link copied from Messages or a browser can be on the
 * pasteboard as a URL alone, so paste does nothing; this returns the link to insert instead.
 * Ordinary clipboards, and every other key, are left to the normal paste.
 */
export function linkToPaste(input: AppShortcutInput, clipboard: LinkClipboard): string | null {
  const primary = Boolean(input.meta) !== Boolean(input.control);
  if (input.type !== 'keyDown' || !primary || input.shift || input.alt || input.key?.toLowerCase() !== 'v') return null;
  if (clipboard.readText()) return null;
  return clipboard.readBookmark().url || null;
}
