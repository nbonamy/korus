import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'darwin') {
  console.log('Skipping the macOS TTS helper on this platform.');
  process.exit(0);
}

const packageDir = path.join(rootDir, 'native', 'tts-helper');
const destinationDir = path.join(rootDir, 'client/electron', '.tts');
const destination = path.join(destinationDir, 'app-tts-helper');
const buildResult = spawnSync('swift', [
  'build',
  '--package-path', packageDir,
  '--configuration', 'release',
  '--product', 'app-tts-helper',
], { stdio: 'inherit' });

if (buildResult.error) throw buildResult.error;
if (buildResult.status !== 0) process.exit(buildResult.status ?? 1);

const result = spawnSync('swift', [
  'build',
  '--package-path', packageDir,
  '--configuration', 'release',
  '--show-bin-path',
], { encoding: 'utf8' });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const binaryDir = result.stdout.trim().split('\n').at(-1);
if (!binaryDir) throw new Error('Swift did not report the TTS helper output directory.');

fs.mkdirSync(destinationDir, { recursive: true });
fs.copyFileSync(path.join(binaryDir, 'app-tts-helper'), destination);
fs.chmodSync(destination, 0o755);
console.log(`Prepared ${destination}`);
