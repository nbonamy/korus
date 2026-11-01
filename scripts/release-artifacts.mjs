import fs from 'node:fs/promises';
import path from 'node:path';
import product from '../core/src/product.json' with { type: 'json' };

export const targets = ['darwin-arm64', 'win32-x64', 'linux-x64', 'linux-arm64'];

const requiredExtensions = {
  darwin: ['.zip', '.dmg'],
  win32: ['.zip', '.exe', '.nupkg', 'RELEASES'],
  linux: ['.zip', '.deb', '.rpm'],
};

// A target directory is publishable only when it holds every installer type its platform ships.
export async function listTarget(directory, target) {
  const names = await fs.readdir(directory).catch(() => []);
  for (const extension of requiredExtensions[target.split('-')[0]]) {
    if (!names.some(name => name.endsWith(extension))) throw new Error(`Missing ${extension} artifact for ${target}.`);
  }
  return names.sort().map(name => path.join(directory, name));
}

// Copies installers out of Forge's make output under stable, download-friendly names.
export async function collectArtifacts({ source, output, target }) {
  if (!targets.includes(target)) throw new Error(`Unsupported target: ${target}`);
  await fs.mkdir(output, { recursive: true });
  const names = new Set();
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(zip|dmg|exe|nupkg|deb|rpm)$|^RELEASES(\.json)?$/.test(entry.name)) {
        const extension = path.extname(entry.name);
        // Squirrel's RELEASES references the original nupkg filename. Keep both intact.
        const name = extension === '.dmg' ? product.downloadFileName
          : extension === '.exe' ? `${product.slug}-${target}-setup.exe`
          : ['.zip', '.deb', '.rpm'].includes(extension) ? `${product.slug}-${target}${extension}` : entry.name;
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || names.has(name)) throw new Error(`Unsafe/duplicate artifact name: ${name}`);
        names.add(name);
        await fs.copyFile(file, path.join(output, name));
      }
    }
  }
  await visit(source);
  await listTarget(output, target);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const target = process.argv[2];
  const signed = process.platform === 'darwin';
  const task = process.platform + '-' + process.arch !== target ? Promise.reject(new Error('Incorrect native runner.'))
    : signed && (process.env.APP_SKIP_SIGNING === '1' || process.env.TEST) ? Promise.reject(new Error('Signed artifacts required.'))
    : collectArtifacts({ source: 'client/electron/out/make', output: `out/release/${target}`, target });
  task.catch(error => { console.error(error.message); process.exitCode = 1; });
}
