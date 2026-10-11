import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { createCompanionRelay } from './relay';
import { z } from 'zod';
import { startRelayHealth } from './relay-health';

const configSchema = z.object({ listen: z.string().regex(/^\/ip[46]\/.+\/tcp\/\d+\/tls\/ws$/),
  hostIds: z.array(z.string().regex(/^[a-zA-Z0-9]{32,128}$/)).min(1).max(100),
  stateDirectory: z.string().min(1), certificateFile: z.string().min(1), privateKeyFile: z.string().min(1), healthPort: z.number().int().min(1024).max(65535).optional() }).strict();
export async function runCompanionRelay(configFile: string) {
  if (!configFile) throw new Error('Provide the relay operator configuration file.');
  const config = configSchema.parse(JSON.parse(await readFile(configFile, 'utf8')));
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  const identityFile = path.join(config.stateDirectory, 'identity.key');
  let identity;
  try { identity = privateKeyFromProtobuf(await readFile(identityFile)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Relay identity is invalid. Restore it; do not silently replace pinned identities.');
    identity = await generateKeyPair('Ed25519');
    await writeFile(identityFile, privateKeyToProtobuf(identity), { flag: 'wx', mode: 0o600 });
  }
  const relay = await createCompanionRelay({ key: identity, listen: config.listen, hostIds: config.hostIds,
    tls: { cert: await readFile(config.certificateFile, 'utf8'), key: await readFile(config.privateKeyFile, 'utf8') } });
  let health;
  try { health = config.healthPort ? await startRelayHealth(relay, config.healthPort) : undefined; }
  catch (error) { await relay.stop(); throw error; }
  process.stdout.write(`Companion relay ${relay.peerId}\n${relay.getMultiaddrs().join('\n')}\n`);
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; health?.closeAllConnections(); health?.close(); void relay.stop(); } };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return relay;
}
