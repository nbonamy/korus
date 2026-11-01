export function codexPairingUrl(pairingCode: string): string {
  const url = new URL('https://chatgpt.com/codex/pair');
  url.searchParams.set('pairing_code', pairingCode);
  return url.toString();
}
