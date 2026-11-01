import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Stages the immutable upstream distribution; never installs anything on the user's machine. */
export async function prepareMobileSimulator({ root = path.resolve(import.meta.dirname, '..'), platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'darwin') return null;
  const release = JSON.parse(fs.readFileSync(path.join(root, 'mobile-simulator-release.json'), 'utf8'));
  // The simulator is optional: hosts without a pinned companion build without it.
  if (arch !== release.arch || platform !== release.platform) return null;
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error('Invalid mobile simulator release pin.');
  const cache = path.join(root, 'client/electron/.mobile-simulator-artifacts', release.version);
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, 'companion.tar.gz');
  if (!fs.existsSync(archive)) {
    const response = await fetch(release.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Could not download mobile simulator companion (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('Mobile simulator companion checksum mismatch.');
    fs.writeFileSync(archive, bytes);
  }
  if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== release.sha256) throw new Error('Mobile simulator companion checksum mismatch.');
  const staging = fs.mkdtempSync(path.join(cache, 'stage-'));
  const output = path.join(root, 'client/electron/.mobile-simulator/mobile-simulator');
  try {
    execFileSync('tar', ['-xzf', archive, '-C', staging], { stdio: 'pipe' });
    for (const required of ['idb_companion', 'Resources/SimulatorFrameworkBridge-iOS', 'Resources/Swift']) {
      if (!fs.existsSync(path.join(staging, required))) throw new Error(`Incomplete mobile simulator companion: ${required}.`);
    }
    fs.cpSync(path.join(root, 'client/electron/resources/mobile-simulator'), staging, { recursive: true });
    fs.copyFileSync(path.join(root, 'mobile-simulator-release.json'), path.join(staging, 'release.json'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    return output;
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // Development tolerates a missing companion (offline, bad cache); packaging and release builds stay strict.
  const optional = process.argv.includes('--optional');
  try {
    const directory = await prepareMobileSimulator();
    console.log(directory ? 'Prepared pinned mobile simulator companion.' : 'Skipping mobile simulator companion: no pinned build for this host.');
  } catch (error) {
    if (!optional) throw error;
    console.warn(`Mobile simulator companion unavailable; iOS control is disabled. ${error instanceof Error ? error.message : error}`);
  }
}
