import { describe, expect, it } from 'vitest';
import { generatePairingCode, normalizePairingCode, formatPairingCode, pairingAlphabet } from '../companion-pairing';

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
  it('formats partial input without changing the code', () => {
    expect(formatPairingCode('k7qdm2')).toBe('K7QD-M2');
    expect(formatPairingCode('k7qd')).toBe('K7QD');
    expect(formatPairingCode('k7qd-m2xpzz')).toBe('K7QD-M2XP');
  });
});
