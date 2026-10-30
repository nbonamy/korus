import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { companionDecodedResponseLimit, companionResponseLimit, encodeCompanionPayload } from '../companion-protocol';
import { readEmbeddedConversationImage, conversationImageInput } from '../conversation-images';
import { readConversationDiff } from '../conversation-diffs';
import type { ConversationContentChunk, ConversationContentInput } from '../contracts/conversation';
import { readFirstCompanionResponse } from '../companion-response';

async function* fragmented(payload: Uint8Array) {
  const wire = encodeCompanionPayload(payload, companionResponseLimit);
  yield wire.subarray(0, 7); yield wire.subarray(7);
}

describe('compressed companion response safety', () => {
  // Exercise the framed reply -> scoped content reader boundary used by both clients.
  it('reconstructs image and historical diff content from fragmented compressed replies', async () => {
    const id = 'a'.repeat(64); const input = { sessionId: 'thread', contentId: id };
    const transfer = (text: string) => async (request: ConversationContentInput) => {
      expect(request).toMatchObject(input);
      const bytes = Buffer.from(text); const end = Math.min(bytes.length, request.offset + 17);
      const chunk = { data: bytes.subarray(request.offset, end).toString('base64'), totalBytes: bytes.length, nextOffset: end < bytes.length ? end : null };
      return await readFirstCompanionResponse(fragmented(gzipSync(Buffer.from(JSON.stringify(chunk))))) as ConversationContentChunk;
    };
    const image = 'data:image/png;base64,' + Buffer.from('image bytes').toString('base64');
    expect(await readEmbeddedConversationImage(`conversation-image:thread:${id}`, transfer(image))).toBe(image);
    expect(conversationImageInput('conversation-image:%ZZ:' + id)).toBeNull();
    const text = 'historical 🪴\nlast line';
    const reference = { ...input, byteLength: Buffer.byteLength(text) };
    for (const changeKind of ['add', 'delete'] as const) {
      const diff = await readConversationDiff('file.txt', { ...reference, changeKind }, transfer(text));
      expect(diff).toContain(`${changeKind === 'add' ? '+' : '-'}historical 🪴`);
      expect(diff).toContain('\\ No newline at end of file');
    }
    for (const patch of ['@@ -1 +1 @@\n-old\n+new\n', 'diff --git a/file.txt b/file.txt\n@@ -1 +1 @@\n-old\n+new\n']) {
      const diff = await readConversationDiff('file.txt', { ...input, byteLength: Buffer.byteLength(patch), changeKind: 'update' }, transfer(patch));
      expect(diff.endsWith(patch)).toBe(true);
    }
    await expect(readConversationDiff('file.txt', { ...reference, changeKind: 'add' }, transfer(text), () => false)).rejects.toThrow('changed');
  });

  it('refuses corrupt or oversized content replies even inside valid compressed frames', async () => {
    const id = 'a'.repeat(64);
    const read = async (chunk: ConversationContentChunk) => await readFirstCompanionResponse(fragmented(gzipSync(Buffer.from(JSON.stringify(chunk))))) as ConversationContentChunk;
    for (const chunk of [
      { data: 'eA==', totalBytes: 2, nextOffset: null },
      { data: 'eA==', totalBytes: 2, nextOffset: 0 },
      { data: '', totalBytes: 2, nextOffset: 0 },
      { data: 'eA==', totalBytes: 150_000_000, nextOffset: 1 },
    ]) {
      await expect(readEmbeddedConversationImage(`conversation-image:thread:${id}`, () => read(chunk))).rejects.toThrow();
      await expect(readConversationDiff('file.txt', { sessionId: 'thread', contentId: id, byteLength: 2, changeKind: 'add' }, () => read(chunk))).rejects.toThrow();
    }
    await expect(readEmbeddedConversationImage('not-a-reference', () => read({ data: '', totalBytes: 0, nextOffset: null }))).rejects.toThrow('reference');
    await expect(readEmbeddedConversationImage(`conversation-image:thread:${id}`, () => read({ data: 'eA==', totalBytes: 1, nextOffset: null }))).rejects.toThrow('image data');
    await expect(readConversationDiff('file.txt', { sessionId: '', contentId: id, byteLength: 2, changeKind: 'add' }, () => read({ data: '', totalBytes: 0, nextOffset: null }))).rejects.toThrow('reference');
  });
  it('rejects expansion beyond the decoded bound even when the compressed frame fits the wire bound', async () => {
    const payload = gzipSync(Buffer.alloc(companionDecodedResponseLimit + 1, 32));
    expect(payload.byteLength).toBeLessThan(companionResponseLimit);
    await expect(readFirstCompanionResponse(fragmented(payload))).rejects.toThrow('response too large');
  });

  it.each([
    ['broken gzip', new Uint8Array([0x1f, 0x8b, 0, 0])],
    ['non-JSON contents', gzipSync(Buffer.from('{'))],
    ['invalid UTF-8', gzipSync(new Uint8Array([0x22, 0xff, 0x22]))],
  ])('rejects %s instead of delivering a provider payload', async (_name, payload) => {
    await expect(readFirstCompanionResponse(fragmented(payload))).rejects.toThrow();
  });

  it('reports a missing response when the peer closes before sending a frame', async () => {
    async function* closed() { /* No response received. */ }
    await expect(readFirstCompanionResponse(closed())).rejects.toThrow('closed without a frame');
  });
});
