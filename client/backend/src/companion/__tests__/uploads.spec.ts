import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupPromptUploads, storePromptUploads } from '../uploads';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const fresh = async () => { const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-uploads-')); directories.push(directory); return directory; };

describe('phone attachments on the laptop', () => {
  it('expires idle uploads without a new upload, preserving queued and active attachments', async () => {
    const directory = await fresh();
    const upload = [{ type: 'file' as const, name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('notes') }];
    const [expired] = await storePromptUploads(directory, upload, Date.now(), 'idle');
    const [active] = await storePromptUploads(directory, upload, Date.now(), 'working');
    const [queued] = await storePromptUploads(directory, upload, Date.now(), 'queued');
    const stale = new Date(Date.now() - 2 * 86_400_000);
    for (const item of [expired!, active!, queued!]) await utimes(path.dirname(item.path), stale, stale);
    await cleanupPromptUploads(directory, { activeAgentIds: ['working'], protectedPaths: [queued!.path] });
    await expect(stat(expired!.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(active!.path, 'utf8')).toBe('notes');
    expect(await readFile(queued!.path, 'utf8')).toBe('notes');
    await cleanupPromptUploads(directory);
    expect(await readdir(path.join(directory, 'uploads'))).toStrictEqual([]);
  });

  it('writes each upload privately and returns the attachment a prompt can reference', async () => {
    const directory = await fresh();
    const attachments = await storePromptUploads(directory, [
      { type: 'image', name: 'Photo 1.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes') },
      { type: 'file', name: '../../etc/passwd', mimeType: 'text/plain', data: Buffer.from('notes') },
      { type: 'file', name: 'Photo 1.jpg', mimeType: 'application/octet-stream', data: Buffer.from('different bytes') },
    ]);
    expect(attachments).toHaveLength(3);
    expect(attachments[0]).toMatchObject({ type: 'image', name: 'Photo 1.jpg', mimeType: 'image/jpeg' });
    expect(await readFile(attachments[0]!.path, 'utf8')).toBe('jpeg-bytes');
    // A hostile name can never leave the upload directory.
    expect(path.dirname(path.dirname(attachments[1]!.path))).toBe(path.join(directory, 'uploads'));
    expect(path.basename(attachments[1]!.path)).toBe('2-passwd');
    expect((await stat(attachments[0]!.path)).mode & 0o777).toBe(0o600);
    expect(await readFile(attachments[2]!.path, 'utf8')).toBe('different bytes');
    expect(new Set(attachments.map((item) => item.path)).size).toBe(3);
  });
  it('sweeps expired uploads without requiring a replacement upload', async () => {
    const directory = await fresh();
    const [old] = await storePromptUploads(directory, [{ type: 'file', name: 'old.txt', mimeType: 'text/plain', data: Buffer.from('x') }]);
    const stale = new Date(Date.now() - 2 * 86_400_000);
    await utimes(path.dirname(old!.path), stale, stale);
    await cleanupPromptUploads(directory);
    expect(await readdir(path.join(directory, 'uploads'))).toHaveLength(0);
  });
  it('stores nothing when there is nothing to store', async () => {
    const directory = await fresh();
    expect(await storePromptUploads(directory, [])).toStrictEqual([]);
  });
});
