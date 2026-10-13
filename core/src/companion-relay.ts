/** Configuration is explicit and never comes from a peer. Plaintext is accepted only on loopback, where traffic never leaves the machine (and is Noise-encrypted anyway). */
export function relayAddress(origin: string, peerId: string): string {
  const url = new URL(origin);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'wss:' && !(loopback && url.protocol === 'ws:'))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^[a-zA-Z0-9]{32,128}$/.test(peerId)) throw new Error('Invalid secure relay configuration.');
  const host = url.hostname;
  const protocol = host.startsWith('[') ? 'ip6' : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 'ip4' : 'dns4';
  return `/${protocol}/${host.replace(/^\[|\]$/g, '')}/tcp/${url.port || 443}${url.protocol === 'wss:' ? '/tls' : ''}/ws/p2p/${peerId}`;
}
export const companionAdmissionProtocol = '/workspace/companion-admission/1.0.0';
/** A phone resolves a pairing channel to the laptop advertising it; authentication is end to end. */
export const companionRendezvousProtocol = '/workspace/companion-rendezvous/1.0.0';
