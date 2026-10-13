import { describe, expect, it } from 'vitest';
import { createPairingExchange, generatePairingCode, normalizePairingCode, pairingChannel, formatPairingCode, pairingAlphabet } from '../companion-pairing';

const phone = '12D3KooWPhone'.padEnd(52, 'p'); const laptop = '12D3KooWLaptop'.padEnd(52, 'l');
function exchange(initiatorCode: string, responderCode: string, ids = { initiator: phone, responder: laptop }, responderIds = ids) {
  const initiator = createPairingExchange({ role: 'initiator', code: initiatorCode, initiatorId: ids.initiator, responderId: ids.responder });
  const responder = createPairingExchange({ role: 'responder', code: responderCode, initiatorId: responderIds.initiator, responderId: responderIds.responder });
  return { initiator: initiator.finish(responder.message), responder: responder.finish(initiator.message), messages: [initiator.message, responder.message] };
}

describe('pairing codes', () => {
  it('generates short codes from an unambiguous alphabet in the 4-4 shape', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generatePairingCode()));
    expect(codes.size).toBeGreaterThan(190);
    for (const code of codes) {
      expect(code).toMatch(new RegExp(`^[${pairingAlphabet}]{4}-[${pairingAlphabet}]{4}$`));
      expect(normalizePairingCode(code)).toBe(code.replace('-', ''));
    }
    expect(pairingAlphabet).not.toMatch(/[01IO]/);
  });
  it('accepts the way people type codes and rejects anything else', () => {
    expect(normalizePairingCode(' k7qd m2xp ')).toBe('K7QDM2XP');
    expect(normalizePairingCode('k7qd–m2xp')).toBe('K7QDM2XP');
    expect(normalizePairingCode('K7QD-M2X')).toBeNull();
    expect(normalizePairingCode('K7QD-M2XPQ')).toBeNull();
    expect(normalizePairingCode('K7QD-M2X0')).toBeNull();
  });
  it('splits the public rendezvous channel from the shared password and formats partial input', () => {
    expect(pairingChannel('K7QDM2XP')).toBe('K7QD');
    expect(formatPairingCode('k7qdm2')).toBe('K7QD-M2');
    expect(formatPairingCode('k7qd')).toBe('K7QD');
    expect(formatPairingCode('k7qd-m2xpzz')).toBe('K7QD-M2XP');
  });
});

describe('password-authenticated pairing exchange', () => {
  it('lets both sides prove they know the code and derive matching confirmations', () => {
    const { initiator, responder } = exchange('K7QDM2XP', 'K7QDM2XP');
    expect(initiator.initiatorConfirm).toStrictEqual(responder.initiatorConfirm);
    expect(initiator.responderConfirm).toStrictEqual(responder.responderConfirm);
    expect(initiator.initiatorConfirm).not.toStrictEqual(initiator.responderConfirm);
  });
  it('fails confirmation for a wrong code without revealing anything checkable offline', () => {
    const { initiator, responder } = exchange('K7QDM2XP', 'K7QDM2XQ');
    expect(initiator.responderConfirm).not.toStrictEqual(responder.responderConfirm);
    expect(initiator.initiatorConfirm).not.toStrictEqual(responder.initiatorConfirm);
  });
  it('binds the confirmation to both authenticated peers so a relayed exchange cannot succeed', () => {
    const attacker = '12D3KooWAttacker'.padEnd(52, 'a');
    const { initiator, responder } = exchange('K7QDM2XP', 'K7QDM2XP', { initiator: phone, responder: attacker }, { initiator: attacker, responder: laptop });
    expect(initiator.responderConfirm).not.toStrictEqual(responder.responderConfirm);
  });
  it('uses fresh messages each time and refuses malformed or degenerate peer messages', () => {
    expect(exchange('K7QDM2XP', 'K7QDM2XP').messages[0]).not.toStrictEqual(exchange('K7QDM2XP', 'K7QDM2XP').messages[0]);
    const side = createPairingExchange({ role: 'initiator', code: 'K7QDM2XP', initiatorId: phone, responderId: laptop });
    expect(() => side.finish(new Uint8Array(32))).toThrow('Invalid pairing message');
    expect(() => side.finish(new Uint8Array(31))).toThrow('Invalid pairing message');
    expect(() => side.finish(new Uint8Array(32).fill(7))).toThrow('Invalid pairing message');
  });
});
