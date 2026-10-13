import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

/** 32 symbols, no 0/1/I/O: five bits each, so a code reads aloud and types without guessing. */
export const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeLength = 8;
const channelLength = 4;
const encoder = new TextEncoder();

function symbols(input: string): string {
  return [...input.toUpperCase()].filter((character) => pairingAlphabet.includes(character)).join('');
}
export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(codeLength));
  return formatPairingCode(Array.from(bytes, (byte) => pairingAlphabet[byte & 31]).join(''));
}
/** Returns the 8 code symbols, or null when the text is not a complete valid code. */
export function normalizePairingCode(input: string): string | null {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return stripped.length === codeLength && symbols(stripped) === stripped ? stripped : null;
}
/** The first half is the public rendezvous channel at the relay; the whole code is the PAKE password. */
export function pairingChannel(code: string): string { return code.slice(0, channelLength); }
export function formatPairingCode(input: string): string {
  const typed = symbols(input.toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, codeLength);
  return typed.length > channelLength ? `${typed.slice(0, channelLength)}-${typed.slice(channelLength)}` : typed;
}

export type PairingRole = 'initiator' | 'responder';
export type PairingConfirmations = { initiatorConfirm: Uint8Array; responderConfirm: Uint8Array };
const domain = 'companion-pairing-cpace-ristretto255-sha512-v1';
const point = ristretto255.Point;

function lengthPrefixed(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + 4 + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    new DataView(out.buffer).setUint32(offset, part.byteLength); out.set(part, offset + 4); offset += 4 + part.byteLength;
  }
  return out;
}
function randomScalar(): bigint {
  for (;;) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(64)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const scalar = point.Fn.create(BigInt(`0x${hex}`));
    if (scalar !== 0n) return scalar;
  }
}
/** Constant-time comparison for confirmation values. */
export function pairingConfirmationsMatch(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.byteLength ^ b.byteLength;
  for (let index = 0; index < Math.min(a.byteLength, b.byteLength); index++) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

/**
 * CPace-style balanced PAKE over ristretto255. The code is the password; both Noise-authenticated peer
 * identities are part of the generator, so an exchange relayed between two different connections fails.
 * The low-entropy code is never usable for an offline guess: only an online attempt, which the laptop
 * limits per invitation, can test it.
 */
export function createPairingExchange(options: { role: PairingRole; code: string; initiatorId: string; responderId: string }) {
  const generator = ristretto255_hasher.hashToCurve(
    lengthPrefixed(encoder.encode(options.code), encoder.encode(options.initiatorId), encoder.encode(options.responderId)), { DST: domain });
  const secret = randomScalar();
  const message = generator.multiply(secret).toBytes();
  return {
    message,
    /** Pass the peer's message; returns both sides' confirmation values for this transcript. */
    finish(peerMessage: Uint8Array): PairingConfirmations {
      let shared;
      try {
        if (peerMessage.byteLength !== 32) throw new Error('length');
        const peer = point.fromBytes(peerMessage);
        if (peer.is0()) throw new Error('identity');
        shared = peer.multiply(secret);
        if (shared.is0()) throw new Error('identity');
      } catch { throw new Error('Invalid pairing message.'); }
      const [initiatorMessage, responderMessage] = options.role === 'initiator' ? [message, peerMessage] : [peerMessage, message];
      const transcript = lengthPrefixed(initiatorMessage, responderMessage, encoder.encode(options.initiatorId), encoder.encode(options.responderId));
      const key = sha512(lengthPrefixed(encoder.encode(domain), shared.toBytes(), transcript));
      return { initiatorConfirm: hmac(sha256, key, encoder.encode('initiator')), responderConfirm: hmac(sha256, key, encoder.encode('responder')) };
    },
  };
}
