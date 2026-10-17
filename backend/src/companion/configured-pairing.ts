import { readFile } from 'node:fs/promises';
import { peerIdFromString } from '@libp2p/peer-id';
import { normalizePairingCode } from '@workspace/core/companion-pairing';
import { z } from 'zod';
import { RelayStartupError } from './relay-startup-error';

const schema = z.object({
  code: z.string().refine(value => normalizePairingCode(value) !== null).transform(value => normalizePairingCode(value)!),
  hostId: z.string().refine(value => { try { peerIdFromString(value); return true; } catch { return false; } }),
}).strict();
export type ConfiguredPairing = z.infer<typeof schema>;

/** Both services read the same operator-owned file; no review code is compiled into either binary. */
export async function readConfiguredPairing(env: NodeJS.ProcessEnv): Promise<ConfiguredPairing | undefined> {
  const file = env.APP_COMPANION_PAIRING_CONFIG;
  if (file === undefined) return undefined;
  try { return schema.parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (cause) {
    throw new RelayStartupError('Invalid companion pairing configuration. APP_COMPANION_PAIRING_CONFIG must name a JSON file containing a valid code and hostId.', { cause });
  }
}
