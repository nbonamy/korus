import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { createCompanionRelay } from './relay';
import { z } from 'zod';
import { startRelayHealth } from './relay-health';
import { RelayStartupError } from './relay-startup-error';

const peerId = z.string().regex(/^[a-zA-Z0-9]{32,128}$/);
const configSchema = z.object({ listen: z.string().regex(/^\/ip[46]\/.+\/tcp\/\d+\/(tls\/)?ws$/),
  hostIds: z.array(peerId).min(1).max(100),
  stateDirectory: z.string().min(1), certificateFile: z.string().min(1).optional(), privateKeyFile: z.string().min(1).optional(), healthPort: z.number().int().min(1024).max(65535).optional() }).strict()
  .superRefine((config, context) => {
    const secure = config.listen.endsWith('/tls/ws');
    // Plaintext listening exists for local development only; anything reachable needs TLS.
    if (secure && (!config.certificateFile || !config.privateKeyFile)) context.addIssue({ code: 'custom', message: 'A TLS listener needs certificateFile and privateKeyFile.' });
    if (!secure && !/^\/ip(4\/127\.0\.0\.1|6\/::1)\//.test(config.listen)) context.addIssue({ code: 'custom', message: 'A plaintext listener must be bound to loopback.' });
  });
export function parseRelayConfig(source: string) {
  try { return configSchema.parse(JSON.parse(source)); }
  catch (cause) {
    throw new RelayStartupError('Invalid operator configuration. Provide valid JSON with a listen address, admitted hostIds and stateDirectory; public listeners require TLS certificateFile and privateKeyFile, and plaintext listeners must use loopback.', { cause });
  }
}
export async function runCompanionRelay(configFile: string) {
  if (!configFile) throw new RelayStartupError('Provide the relay operator configuration file as the first argument, or use npm run dev:relay for local development.');
  const config = parseRelayConfig(await readFile(configFile, 'utf8'));
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const identityFile = path.join(config.stateDirectory, 'identity.key');
  let identity;
  try { identity = privateKeyFromProtobuf(await readFile(identityFile)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      throw new RelayStartupError('The persistent relay identity could not be read. Check access or restore the original identity; do not replace it, because paired devices pin this identity.', { cause: error });
    }
    identity = await generateKeyPair('Ed25519');
    await writeFile(identityFile, privateKeyToProtobuf(identity), { flag: 'wx', mode: 0o600 });
  }
  const relay = await createCompanionRelay({ key: identity, listen: config.listen, hostIds: config.hostIds,
    tls: config.certificateFile && config.privateKeyFile ? { cert: await readFile(config.certificateFile, 'utf8'), key: await readFile(config.privateKeyFile, 'utf8') } : undefined });
  let health;
  try { health = config.healthPort ? await startRelayHealth(relay, config.healthPort) : undefined; }
  catch (error) { await relay.stop(); throw error; }
  process.stdout.write(`Companion relay ${relay.peerId}\n${relay.getMultiaddrs().join('\n')}\n`);
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; health?.closeAllConnections(); health?.close(); void relay.stop(); } };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return relay;
}
