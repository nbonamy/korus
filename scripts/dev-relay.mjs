import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const peerIdPattern = /^[a-zA-Z0-9]{32,128}$/;

/**
 * The relay's address comes from the same variables the daemon and the phone build read.
 * A development relay is local and plain: a ws://localhost:<port> origin, no certificate.
 */
export function relayEndpoint(env, dotenv) {
  const file = parseEnv(dotenv);
  const origin = (env.APP_COMPANION_RELAY_URL ?? file.APP_COMPANION_RELAY_URL ?? '').trim();
  const peerId = (env.APP_COMPANION_RELAY_PEER_ID ?? file.APP_COMPANION_RELAY_PEER_ID ?? '').trim();
  const invalid = () => new Error('Set APP_COMPANION_RELAY_URL to ws://localhost:<port> (in .env or the environment). APP_COMPANION_RELAY_PEER_ID is printed once the relay starts.');
  let url;
  try { url = new URL(origin); } catch { throw invalid(); }
  const port = Number(url.port);
  if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !Number.isInteger(port) || port < 1024 || port > 65535) throw invalid();
  if (peerId && !peerIdPattern.test(peerId)) throw new Error('APP_COMPANION_RELAY_PEER_ID is not a relay identity.');
  return { origin: url.origin, port, peerId };
}

/** APNs secrets remain files on the relay; only their locations enter local configuration. */
export function relayPushConfig(env, dotenv, product) {
  const values = { ...parseEnv(dotenv), ...env };
  const keyId = values.APP_COMPANION_APNS_KEY_ID?.trim();
  const privateKeyFile = values.APP_COMPANION_APNS_KEY_FILE?.trim();
  const teamId = values.APP_COMPANION_APNS_TEAM_ID?.trim();
  if (!keyId && !privateKeyFile && !teamId) return undefined;
  const environment = values.APP_COMPANION_APNS_ENVIRONMENT?.trim() || 'development';
  if (!/^[A-Z0-9]{10}$/.test(keyId ?? '') || !/^[A-Z0-9]{10}$/.test(teamId ?? '') || !privateKeyFile
    || !['development', 'production'].includes(environment)) throw new Error('Set APP_COMPANION_APNS_KEY_ID, APP_COMPANION_APNS_TEAM_ID, APP_COMPANION_APNS_KEY_FILE and APP_COMPANION_APNS_ENVIRONMENT (development or production).');
  return { teamId, topic: product.appId, [environment]: { keyId, privateKeyFile } };
}

/** The laptops the relay admits: an explicit list, or the identity of the local daemon. */
export async function relayHostIds(env, companionState) {
  const listed = (env.APP_COMPANION_RELAY_HOST_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (listed.length) return listed;
  if (!companionState) throw new Error('No laptop identity yet. Start the desktop app once (it creates one), or set APP_COMPANION_RELAY_HOST_IDS.');
  const { privateKeyFromProtobuf } = await import('@libp2p/crypto/keys');
  const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
  return [peerIdFromPrivateKey(privateKeyFromProtobuf(Buffer.from(JSON.parse(companionState).identity, 'base64'))).toString()];
}

function readIfPresent(file) {
  try { return readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run dev:relay\nRebuilds the relay bundle, then runs a local companion relay (plain ws, loopback only) on the port in APP_COMPANION_RELAY_URL (.env or environment), admitting the local daemon\'s laptop identity.\nCtrl+C stops it.');
    return;
  }
  const endpoint = relayEndpoint(process.env, readIfPresent(path.join(root, '.env')));
  const product = JSON.parse(readFileSync(path.join(root, 'core/src/product.json'), 'utf8'));
  const home = process.env.APP_HOME?.trim() || path.join(homedir(), product.homeDirectory);
  const hostIds = await relayHostIds(process.env, readIfPresent(path.join(home, 'companion/state.json')));

  // Always rebuilt: a stale bundle would silently run an old protocol.
  const bundle = path.join(root, 'backend/relay-dist/relay.mjs');
  const npm = process.env.npm_execpath;
  execFileSync(npm ? process.execPath : 'npm', npm ? [npm, 'run', 'build:relay', '-w', '@workspace/backend'] : ['run', 'build:relay', '-w', '@workspace/backend'], { cwd: root, stdio: 'inherit' });

  const directory = path.join(root, '.app-dev/relay');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const configFile = path.join(directory, 'relay.json');
  writeFileSync(configFile, JSON.stringify({ listen: `/ip4/127.0.0.1/tcp/${endpoint.port}/ws`, hostIds, stateDirectory: path.join(directory, 'identity'), apns: relayPushConfig(process.env, readIfPresent(path.join(root, '.env')), product) }), { mode: 0o600 });

  const child = spawn(process.execPath, [bundle, configFile], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  let announced = false;
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const identity = !announced && /Companion relay (\S+)/.exec(String(chunk))?.[1];
    if (!identity) return;
    announced = true;
    console.log(`\nRelay ${endpoint.origin} for laptop ${hostIds.join(', ')}`);
    if (identity !== endpoint.peerId) console.log(`\nSet this in .env, then rebuild the phone app and restart the desktop app:\nAPP_COMPANION_RELAY_PEER_ID=${identity}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 1));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
