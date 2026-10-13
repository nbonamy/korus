import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { open, type Entry, type ZipFile } from 'yauzl';
import { AcpRuntime } from './acp-runtime';
import { managedRuntimeDirectory, resolveAcpRuntime } from './runtime';
import { resolveAcpReleaseAsset, type AcpReleaseAsset } from './release';

/** Installs on explicit request; provider binaries are never app resources. */
export async function installAcpRuntime(): Promise<void> {
  const asset = resolveAcpReleaseAsset();
  const destination = managedRuntimeDirectory();
  if (!asset || !destination) throw new Error('Antigravity installation is unavailable for this platform.');
  if (resolveAcpRuntime()) return;
  if (process.env.APP_ANTIGRAVITY_COMMAND?.trim() || process.env.ANTIGRAVITY_HARNESS_PATH?.trim()) {
    throw new Error('Clear the custom Antigravity runtime paths before using managed installation.');
  }
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const space = await statfs(parent, { bigint: true });
  const required = BigInt(asset.archiveBytes + asset.executable.bytes + asset.harness.bytes + 128 * 1024 * 1024);
  if (space.bavail * space.bsize < required) throw new Error('Not enough free disk space to install Antigravity.');
  const staging = await mkdtemp(path.join(parent, '.install-'));
  try {
    const archive = path.join(staging, 'download.zip');
    await downloadArchive(asset, archive);
    const pair = path.join(staging, 'runtime');
    await mkdir(pair, { mode: 0o700 });
    await extractPair(asset, archive, pair);
    if (process.platform !== 'win32') {
      for (const name of [asset.executable.name, asset.harness.name]) await chmod(path.join(pair, name), 0o755);
    }
    // Verification gets an empty disposable home and never authenticates.
    const runtime = await AcpRuntime.open({
      runtime: { command: path.join(pair, asset.executable.name), harness: path.join(pair, asset.harness.name), args: process.platform === 'linux' ? ['--uid='] : [] },
      cwd: staging, home: path.join(staging, 'home'), filesystem: false,
      onRequest: async () => { throw new Error('Unexpected request while verifying Antigravity.'); },
      onNotification: () => {}, onClose: () => {},
    });
    await runtime.close();
    // Only the complete, verified pair becomes discoverable.
    await rename(pair, destination);
    if (!resolveAcpRuntime()) throw new Error('The installed Antigravity runtime could not be detected. Check custom runtime paths.');
  } finally { await rm(staging, { recursive: true, force: true }); }
}

async function downloadArchive(asset: AcpReleaseAsset, target: string): Promise<void> {
  const signal = AbortSignal.timeout(5 * 60_000);
  let response: Response;
  try { response = await fetch(asset.url, { signal, redirect: 'error', headers: { 'Accept-Encoding': 'identity' } }); }
  catch { throw new Error('Could not download Antigravity from Google. Check your connection and try again.'); }
  if (!response.ok || !response.body) throw new Error('Could not download Antigravity from Google. Try again.');
  const hash = createHash('sha256');
  let bytes = 0;
  const check = new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    if (bytes > asset.archiveBytes) { done(new Error('The Antigravity download exceeds the expected size.')); return; }
    hash.update(chunk); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), check, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
  if (bytes !== asset.archiveBytes || hash.digest('hex') !== asset.sha256) {
    throw new Error('The Antigravity download failed verification. Nothing was installed. Try again.');
  }
}

async function extractPair(asset: AcpReleaseAsset, archive: string, target: string): Promise<void> {
  const zip = await new Promise<ZipFile>((resolve, reject) => open(archive, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, file) => error ? reject(error) : resolve(file)));
  try {
    await new Promise<void>((resolve, reject) => {
      const seen = new Set<string>();
      zip.on('error', reject);
      zip.on('end', () => seen.size === 2 ? resolve() : reject(new Error('The Antigravity archive is missing its runtime or harness.')));
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const expected = [asset.executable, asset.harness].find(file => file.name === entry.fileName);
          const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (!expected || seen.has(entry.fileName) || entry.isEncrypted() || (kind !== 0 && kind !== 0o100000) || entry.uncompressedSize !== expected.bytes) {
            throw new Error('The Antigravity archive contains an unexpected or invalid file.');
          }
          seen.add(entry.fileName);
          const stream = await new Promise<Readable>((resolveStream, rejectStream) => zip.openReadStream(entry, (error, stream) => error ? rejectStream(error) : resolveStream(stream)));
          let bytes = 0;
          const check = new Transform({ transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            done(bytes > expected.bytes ? new Error('The Antigravity archive exceeds the expected size.') : null, chunk);
          } });
          await pipeline(stream, check, createWriteStream(path.join(target, expected.name), { flags: 'wx', mode: 0o700 }));
          if (bytes !== expected.bytes) throw new Error('The Antigravity archive is incomplete.');
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
