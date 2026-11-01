import { describe, expect, it, vi } from 'vitest';
import { readConversationImage, conversationImageReference } from '../images';
import type { CompanionReset } from '@workspace/core/companion-protocol';

const image = { path: '/tmp/shot.png', kind: 'image' as const, size: 3, dataUrl: 'data:image/png;base64,cG5n' };
describe('conversation images', () => {
  it('reads the current source on every request and does not retain deleted images', async () => {
    const load = vi.fn(async () => image);
    expect(await readConversationImage(load)).toStrictEqual({ dataUrl: image.dataUrl });
    const updated = { ...image, dataUrl: 'data:image/png;base64,bmV3' };
    expect(await readConversationImage(async () => updated)).toStrictEqual({ dataUrl: updated.dataUrl });
    const missing = vi.fn(async () => { throw new Error('Source deleted'); });
    await expect(readConversationImage(missing)).rejects.toThrow('Source deleted');
  });

  it('rejects non-image and oversized previews', async () => {
    for (const preview of [{ ...image, kind: 'text' as const, dataUrl: undefined, content: 'private' }, { ...image, dataUrl: 'data:text/plain;base64,cG5n' }, { ...image, dataUrl: 'data:image/png;base64,' + 'a'.repeat(3 * 1024 * 1024) }]) {
      await expect(readConversationImage(async () => preview)).rejects.toThrow('unavailable');
    }
  });

  it('recognizes normal Markdown references and attachments without treating code snippets or other files as an image grant', () => {
    const frame = { payload: { snapshot: { messages: [{ id: 'answer', parts: [
      { type: 'text', text: '[First][shot]\n\n[shot]: </tmp/phone shot.png>\n\n`[Secret](/private/secret.png)`\n\n![Second](file:///tmp/second.png)' },
      { type: 'attachment', attachment: { kind: 'image', path: 'relative.png' } },
    ] }] } } } as CompanionReset;
    expect(conversationImageReference(frame, '/tmp/phone shot.png')).toStrictEqual('/tmp/phone shot.png');
    expect(conversationImageReference(frame, 'file:///tmp/second.png')).toStrictEqual('/tmp/second.png');
    expect(conversationImageReference(frame, 'relative.png')).toStrictEqual('relative.png');
    // Markdown allows a destination with spaces only inside angle brackets, and the renderer passes them through.
    expect(conversationImageReference(frame, '</tmp/phone shot.png>')).toStrictEqual('/tmp/phone shot.png');
    for (const reference of ['/private/secret.png', '/tmp/phone shot.png.backup', 'https://example.com/private.png', '/tmp/unknown.png']) {
      expect(() => conversationImageReference(frame, reference)).toThrow();
    }
  });
});
