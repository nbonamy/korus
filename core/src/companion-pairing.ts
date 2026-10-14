/** 32 symbols, no 0/1/I/O: five bits each, so a code reads aloud and types without guessing. */
export const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codeLength = 8;
const channelLength = 4;
export const pairingLifetimeMs = 300_000;
export type PairingInvitation = { code: string; expiresAt: number };

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
export function formatPairingCode(input: string): string {
  const typed = symbols(input.toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, codeLength);
  return typed.length > channelLength ? `${typed.slice(0, channelLength)}-${typed.slice(channelLength)}` : typed;
}
