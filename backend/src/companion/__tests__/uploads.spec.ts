import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { storePromptUploads } from '../uploads';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const fresh = async () => { const directory = await mkdtemp(path.join(os.tmpdir(), 'companion-uploads-')); directories.push(directory); return directory; };

describe('phone attachments on the laptop', () => {
  it('writes each upload privately and returns the attachment a prompt can reference', async () => {
    const directory = await fresh();
    const attachments = await storePromptUploads(directory, [
      { type: 'image', name: 'Photo 1.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpeg-bytes') },
      { type: 'file', name: '../../etc/passwd', mimeType: 'text/plain', data: Buffer.from('notes') },
    ]);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({ type: 'image', name: 'Photo 1.jpg', mimeType: 'image/jpeg' });
    expect(await readFile(attachments[0]!.path, 'utf8')).toBe('jpeg-bytes');
    // A hostile name can never leave the upload directory.
    expect(path.dirname(path.dirname(attachments[1]!.path))).toBe(path.join(directory, 'uploads'));
    expect(path.basename(attachments[1]!.path)).toBe('passwd');
    expect((await stat(attachments[0]!.path)).mode & 0o777).toBe(0o600);
  });
  it('removes uploads older than a day the next time one is stored', async () => {
    const directory = await fresh();
    const [old] = await storePromptUploads(directory, [{ type: 'file', name: 'old.txt', mimeType: 'text/plain', data: Buffer.from('x') }]);
    const stale = new Date(Date.now() - 2 * 86_400_000);
    await utimes(path.dirname(old!.path), stale, stale);
    await storePromptUploads(directory, [{ type: 'file', name: 'new.txt', mimeType: 'text/plain', data: Buffer.from('y') }]);
    expect(await readdir(path.join(directory, 'uploads'))).toHaveLength(1);
  });
  it('stores nothing when there is nothing to store', async () => {
    const directory = await fresh();
    expect(await storePromptUploads(directory, [])).toStrictEqual([]);
  });
});
