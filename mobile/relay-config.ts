import { parseEnv } from 'node:util';

export type ConfiguredRelay = { origin: string; peerId: string };

const invalid = () => new Error('Set APP_COMPANION_RELAY_URL to the relay wss:// origin (ws://localhost:<port> in development) and APP_COMPANION_RELAY_PEER_ID to its identity, or neither.');
const loopback = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The relay is deployment configuration shared by the laptop daemon and the phone build:
 * `APP_COMPANION_RELAY_URL` + `APP_COMPANION_RELAY_PEER_ID`, from the environment (CI variables)
 * or the repository `.env`. Both values or neither; only these two keys are read.
 */
export function configuredRelay(env: NodeJS.ProcessEnv, dotenv: string): ConfiguredRelay | null {
  const file = parseEnv(dotenv);
  const origin = (env.APP_COMPANION_RELAY_URL ?? file.APP_COMPANION_RELAY_URL ?? '').trim();
  const peerId = (env.APP_COMPANION_RELAY_PEER_ID ?? file.APP_COMPANION_RELAY_PEER_ID ?? '').trim();
  if (!origin && !peerId) return null;
  let url: URL;
  try { url = new URL(origin); } catch { throw invalid(); }
  if ((url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback.includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^[a-zA-Z0-9]{32,128}$/.test(peerId)) throw invalid();
  return { origin: url.origin, peerId };
}
