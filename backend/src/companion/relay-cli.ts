import { ApnsSender } from './apns';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { createCompanionRelay } from './relay';
import { z } from 'zod';
import { startRelayHealth } from './relay-health';
import { RelayStartupError } from './relay-startup-error';
import { readConfiguredPairing } from './configured-pairing';

const apnsKey = z.object({ keyId: z.string().regex(/^[A-Z0-9]{10}$/), privateKeyFile: z.string().min(1) }).strict();
const peerId = z.string().regex(/^[a-zA-Z0-9]{32,128}$/);
const configSchema = z.object({ listen: z.string().regex(/^\/ip[46]\/.+\/tcp\/\d+\/(tls\/)?ws$/),
  trustedProxy: z.boolean().optional(),
  hostIds: z.array(peerId).min(1).max(100).optional(),
  apns: z.object({ teamId: z.string().regex(/^[A-Z0-9]{10}$/), topic: z.string().min(1).max(200), development: apnsKey.optional(), production: apnsKey.optional() }).strict().refine(value => value.development || value.production).optional(),
  stateDirectory: z.string().min(1), certificateFile: z.string().min(1).optional(), privateKeyFile: z.string().min(1).optional(), healthPort: z.number().int().min(1024).max(65535).optional() }).strict()
  .superRefine((config, context) => {
    const secure = config.listen.endsWith('/tls/ws');
    if (config.trustedProxy && !/^\/ip(4\/127\.0\.0\.1|6\/::1)\//.test(config.listen)) context.addIssue({ code: 'custom', message: 'A trusted proxy requires a loopback listener.' });
    // Plaintext listening exists for local development only; anything reachable needs TLS.
    if (secure && (!config.certificateFile || !config.privateKeyFile)) context.addIssue({ code: 'custom', message: 'A TLS listener needs certificateFile and privateKeyFile.' });
    if (!secure && !/^\/ip(4\/127\.0\.0\.1|6\/::1)\//.test(config.listen)) context.addIssue({ code: 'custom', message: 'A plaintext listener must be bound to loopback.' });
  });
export function parseRelayConfig(source: string) {
  try { return configSchema.parse(JSON.parse(source)); }
  catch (cause) {
    throw new RelayStartupError('Invalid operator configuration. Provide valid JSON with a listen address and stateDirectory (hostIds optionally restricts laptops); public listeners require TLS certificateFile and privateKeyFile, and plaintext listeners must use loopback.', { cause });
  }
}
export async function runCompanionRelay(configFile: string, env: NodeJS.ProcessEnv = process.env) {
  if (!configFile) throw new RelayStartupError('Provide the relay operator configuration file as the first argument, or use npm run dev:relay for local development.');
  const config = parseRelayConfig(await readFile(configFile, 'utf8'));
  const pairing = await readConfiguredPairing(env);
  if (pairing && config.hostIds && !config.hostIds.includes(pairing.hostId)) throw new RelayStartupError('The configured pairing destination must be included in hostIds when laptop admission is restricted.');
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
  const senders: Partial<Record<'development' | 'production', ApnsSender>> = {};
  if (config.apns) for (const environment of ['development', 'production'] as const) {
    const key = config.apns[environment];
    if (key) senders[environment] = new ApnsSender({ ...key, teamId: config.apns.teamId, topic: config.apns.topic, environment, privateKey: await readFile(key.privateKeyFile, 'utf8') });
  }
  const push = config.apns ? { send: (registration: import('@workspace/core/companion-notification').CompanionPushRegistration, notification: import('@workspace/core/companion-notification').CompanionNotification) =>
    senders[registration.environment]?.send(registration, notification) ?? Promise.resolve('unavailable' as const) } : undefined;
  const relay = await createCompanionRelay({ push, pairing, key: identity, listen: config.listen, trustedProxy: config.trustedProxy, hostIds: config.hostIds,
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
