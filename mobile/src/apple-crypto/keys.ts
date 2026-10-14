import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import { identity } from 'multiformats/hashes/identity';
import { equals } from 'uint8arrays/equals';
import type { AbortOptions, Ed25519PrivateKey, Ed25519PublicKey, PrivateKey, PublicKey } from '@libp2p/interface';
import type { MultihashDigest } from 'multiformats/hashes/interface';
import * as protobuf from '../../../node_modules/@libp2p/crypto/dist/src/keys/keys.js';
import { appleCrypto, decode, encode } from './bridge';

class ApplePublicKey implements Ed25519PublicKey {
  readonly type = 'Ed25519';
  readonly raw: Uint8Array;
  constructor(raw: Uint8Array) { if (raw.length !== 32) throw new Error('Invalid Ed25519 public key'); this.raw = raw.slice(); }
  toMultihash(): MultihashDigest<0> { return identity.digest(publicKeyToProtobuf(this)); }
  toCID(): CID<unknown, 114, 0, 1> { return CID.createV1(114, this.toMultihash()); }
  toString(): string { return base58btc.encode(this.toMultihash().bytes).slice(1); }
  equals(key?: PublicKey) { return key?.type === this.type && equals(this.raw, key.raw); }
  async verify(data: Uint8Array, signature: Uint8Array, options?: AbortOptions) {
    options?.signal?.throwIfAborted();
    const result = await appleCrypto<{ valid: boolean }>({ op: 'identity.verify', key: encode(this.raw), data: encode(data), signature: encode(signature) });
    options?.signal?.throwIfAborted(); return result.valid;
  }
}
class ApplePrivateKey implements Ed25519PrivateKey {
  readonly type = 'Ed25519';
  readonly raw: Uint8Array;
  readonly publicKey: ApplePublicKey;
  constructor(raw: Uint8Array) {
    if (raw.length !== 64) throw new Error('Invalid Ed25519 private key');
    this.raw = raw.slice(); this.publicKey = new ApplePublicKey(raw.subarray(32));
  }
  equals(key?: PrivateKey) { return key?.type === this.type && equals(this.raw, key.raw); }
  async sign(data: Uint8Array, options?: AbortOptions) {
    options?.signal?.throwIfAborted();
    const result = await appleCrypto<{ signature: string }>({ op: 'identity.sign', key: encode(this.raw), data: encode(data) });
    options?.signal?.throwIfAborted(); return decode(result.signature);
  }
}
export async function generateKeyPair(type: string): Promise<Ed25519PrivateKey> {
  if (type !== 'Ed25519') throw new Error('Unsupported device identity');
  const result = await appleCrypto<{ privateKey: string }>({ op: 'identity.generate' });
  return new ApplePrivateKey(decode(result.privateKey));
}
export function publicKeyFromProtobuf(bytes: Uint8Array): Ed25519PublicKey {
  const key = protobuf.PublicKey.decode(bytes);
  if (key.Type !== protobuf.KeyType.Ed25519 || !key.Data) throw new Error('Unsupported peer identity');
  return new ApplePublicKey(key.Data);
}
export function publicKeyFromMultihash(hash: MultihashDigest): Ed25519PublicKey {
  if (hash.code !== 0) throw new Error('Unsupported peer identity');
  return publicKeyFromProtobuf(hash.digest);
}
export function publicKeyToProtobuf(key: PublicKey): Uint8Array {
  if (key.type !== 'Ed25519') throw new Error('Unsupported peer identity');
  return protobuf.PublicKey.encode({ Type: protobuf.KeyType.Ed25519, Data: key.raw });
}
/** Preserve the existing protobuf seed+public-key representation and therefore the saved PeerId. */
export function privateKeyFromProtobuf(bytes: Uint8Array): Ed25519PrivateKey {
  const key = protobuf.PrivateKey.decode(bytes);
  if (key.Type !== protobuf.KeyType.Ed25519 || !key.Data) throw new Error('Unsupported device identity');
  return new ApplePrivateKey(key.Data);
}
export function privateKeyToProtobuf(key: PrivateKey): Uint8Array {
  if (key.type !== 'Ed25519') throw new Error('Unsupported device identity');
  return protobuf.PrivateKey.encode({ Type: protobuf.KeyType.Ed25519, Data: key.raw });
}
