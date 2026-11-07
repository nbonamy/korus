import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const limit = 5 * 1024 * 1024;
const same = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Observes bytes only; existence is neither freshness nor successful generation. */
export async function cursorImageFile(cwd: string, filename: string): Promise<{url:string;mimeType:string}|null> {
  try {
    if (!filename || filename.length > 4096) return null;
    const lexicalRoot = path.resolve(cwd), root = await realpath(lexicalRoot), requested = path.resolve(lexicalRoot,filename);
    // A trusted workspace may use an OS alias such as /var -> /private/var.
    const inside = (base: string) => { const relative = path.relative(base,requested); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
    if (!inside(lexicalRoot) && !inside(root)) return null;
    const canonical = await realpath(requested);
    const relative = path.relative(root,canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const before = await lstat(canonical);
    if (!before.isFile() || before.size < 8 || before.size > limit) return null;
    const file = await open(canonical,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await file.stat();
      if (!opened.isFile() || !same(before,opened)) return null;
      // One extra byte detects growth without allowing an unbounded readFile allocation.
      const data = Buffer.alloc(before.size+1); let length = 0;
      while (length < data.length) { const read = await file.read(data,length,data.length-length,length); if (!read.bytesRead) break; length += read.bytesRead; }
      if (length !== before.size || !same(opened,await file.stat()) || await realpath(requested) !== canonical || !same(opened,await lstat(canonical))) return null;
      const bytes = data.subarray(0,length);
      const mimeType = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp'
        : ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()) ? 'image/gif' : null;
      return mimeType ? {mimeType,url:`data:${mimeType};base64,${bytes.toString('base64')}`} : null;
    } finally { await file.close(); }
  } catch { return null; }
}
