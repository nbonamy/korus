import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { acpAttachments } from '../attachments';

it('encodes trusted local media and text while sending PDF as a resource link', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'acp-attachments-'));
  try {
    const inputs = [
      ['image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
      ['audio.wav', Buffer.from('RIFF0000WAVEdata')],
      ['notes.txt', Buffer.from('Synthetic context')],
      ['paper.pdf', Buffer.from('%PDF-1.4\nSynthetic fixture')],
    ] as const;
    for (const [name, bytes] of inputs) await writeFile(path.join(root, name), bytes);
    const result = await acpAttachments(inputs.map(([name]) => ({ type: 'file', path: path.join(root, name) })));
    expect(result).toEqual([
      { type: 'image', mimeType: 'image/png', data: inputs[0][1].toString('base64') },
      { type: 'audio', mimeType: 'audio/wav', data: inputs[1][1].toString('base64') },
      { type: 'resource', resource: { uri: pathToFileURL(path.join(root, 'notes.txt')).href, mimeType: 'text/plain', text: 'Synthetic context' } },
      { type: 'resource_link', uri: pathToFileURL(path.join(root, 'paper.pdf')).href, name: 'paper.pdf', mimeType: 'application/pdf' },
    ]);
    await expect(acpAttachments([{ type: 'image', path: path.join(root, 'notes.txt') }])).rejects.toThrow('Unsupported');
    await writeFile(path.join(root, 'binary'), Buffer.from([255, 0, 254]));
    await expect(acpAttachments([{ type: 'file', path: path.join(root, 'binary') }])).rejects.toThrow('supports');
    await expect(acpAttachments([{ type: 'file', path: 'renderer-reference' }])).rejects.toThrow('trusted');
  } finally { await rm(root, { recursive: true, force: true }); }
});
