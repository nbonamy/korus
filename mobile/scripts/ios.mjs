import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ios = path.join(root, 'mobile/ios');

/** Product identity and the relay become build settings: nothing visible is hard-coded in the project. */
export function generatedConfig(product, env, dotenv) {
  const file = parseEnv(dotenv);
  const overrideUrl = (env.APP_COMPANION_RELAY_URL ?? file.APP_COMPANION_RELAY_URL ?? '').trim();
  const overridePeer = (env.APP_COMPANION_RELAY_PEER_ID ?? file.APP_COMPANION_RELAY_PEER_ID ?? '').trim();
  if (Boolean(overrideUrl) !== Boolean(overridePeer)) throw new Error('Set both APP_COMPANION_RELAY_URL and APP_COMPANION_RELAY_PEER_ID.');
  const relayUrl = overrideUrl || product.companionRelay?.origin || '';
  const relayPeer = overridePeer || product.companionRelay?.peerId || '';
  // `//` starts a comment in an xcconfig; `$()` keeps the URL intact.
  const escaped = relayUrl.replace('//', '/$()/');
  return [`COMPANION_BUNDLE_ID = ${product.appId}`, `COMPANION_DISPLAY_NAME = ${product.name}`,
    `COMPANION_RELAY_URL = ${escaped}`, `COMPANION_RELAY_PEER_ID = ${relayPeer}`, ''].join('\n');
}

function readIfPresent(file) { try { return readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }

function prepare() {
  const product = JSON.parse(readFileSync(path.join(root, 'core/src/product.json'), 'utf8'));
  mkdirSync(path.join(ios, 'Config'), { recursive: true });
  writeFileSync(path.join(ios, 'Config/Generated.xcconfig'), generatedConfig(product, process.env, readIfPresent(path.join(root, '.env'))));
}

function build(configuration, destination) {
  prepare();
  execFileSync('npm', ['run', 'build:web', '-w', '@workspace/mobile'], { cwd: root, stdio: 'inherit' });
  // Ad-hoc simulator signing preserves access to the app's Keychain pairing.
  // Linker-only signing with CODE_SIGNING_ALLOWED=NO cannot read those entries.
  execFileSync('xcodebuild', ['-project', path.join(ios, 'Companion.xcodeproj'), '-scheme', 'Companion', '-configuration', configuration, '-destination', destination,
    '-derivedDataPath', path.join(ios, 'Build'), 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'], { stdio: 'inherit' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'prepare') prepare();
  else if (command === 'build') build(process.argv.includes('--release') ? 'Release' : 'Debug', 'generic/platform=iOS Simulator');
  else { console.error('Usage: node scripts/ios.mjs prepare | build [--release]'); process.exit(1); }
}
