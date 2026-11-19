import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import extractZip from 'extract-zip';
import release from '../node-runtime-release.json' with { type: 'json' };

export function nodeRuntimeTarget(platform, arch, config = release) {
  const sha256 = config.checksums?.[`${platform}-${arch}`];
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)
    || !/^\d+\.\d+\.\d+$/.test(config.version) || !/^[a-f0-9]{64}$/.test(sha256 ?? '')) {
    throw new Error(`No pinned Node runtime for ${platform}/${arch}.`);
  }
  const directory = `node-v${config.version}-${platform === 'win32' ? 'win' : platform}-${arch}`;
  const archive = `${directory}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  return {
    platform, arch, version: config.version, directory, archive, sha256,
    executable: platform === 'win32' ? 'node.exe' : 'node',
    url: `https://nodejs.org/dist/v${config.version}/${archive}`,
  };
}

export async function prepareNodeRuntime({ platform, arch, outputDir, cacheDir, config = release }, dependencies = {}) {
  const target = nodeRuntimeTarget(platform, arch, config);
  const fetchArchive = dependencies.fetch ?? fetch;
  const extract = dependencies.extract ?? extractArchive;
  await mkdir(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, target.archive);
  let archive;
  try { archive = await readFile(cachePath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!archive || digest(archive) !== target.sha256) {
    const response = await fetchArchive(target.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Node runtime download failed: HTTP ${response.status}.`);
    archive = Buffer.from(await response.arrayBuffer());
    if (digest(archive) !== target.sha256) throw new Error(`Node runtime checksum mismatch: ${target.archive}.`);
    await writeFile(cachePath, archive);
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'app-node-runtime-'));
  try {
    // Extract the bytes we verified, rather than reopening a mutable shared cache.
    const archivePath = path.join(tempDir, target.archive);
    await writeFile(archivePath, archive);
    await extract(archivePath, tempDir, target);
    const directory = path.join(tempDir, target.directory);
    const executable = path.join(directory, ...(platform === 'win32' ? [] : ['bin']), target.executable);
    const license = path.join(directory, 'LICENSE');
    await readFile(license); // Missing notices must fail packaging before copying the binary.
    await mkdir(outputDir, { recursive: true });
    await copyFile(executable, path.join(outputDir, target.executable));
    await chmod(path.join(outputDir, target.executable), 0o755);
    await copyFile(license, path.join(outputDir, 'LICENSE'));
    await writeFile(path.join(outputDir, 'release.json'), `${JSON.stringify({ version: target.version, platform, arch, archiveSha256: target.sha256 }, null, 2)}\n`);
    return path.join(outputDir, target.executable);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function extractArchive(archivePath, outputDir, target) {
  if (target.platform === 'win32') return extractZip(archivePath, { dir: outputDir });
  execFileSync('tar', ['-xzf', archivePath, '-C', outputDir, `${target.directory}/bin/node`, `${target.directory}/LICENSE`]);
}
