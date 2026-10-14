/** Native Debug builds may explicitly allow local Wi-Fi WS; Noise still encrypts the channel. */
export function relayAddress(origin: string, peerId: string, allowLocalDevelopment = false): string {
  const url = new URL(origin);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const octets = url.hostname.split('.').map(Number);
  const privateIPv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168));
  const localDevelopment = allowLocalDevelopment && (privateIPv4 || url.hostname.endsWith('.local'));
  if ((url.protocol !== 'wss:' && !((loopback || localDevelopment) && url.protocol === 'ws:'))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^[a-zA-Z0-9]{32,128}$/.test(peerId)) throw new Error('Invalid secure relay configuration.');
  const host = url.hostname;
  const protocol = host.startsWith('[') ? 'ip6' : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 'ip4' : 'dns4';
  return `/${protocol}/${host.replace(/^\[|\]$/g, '')}/tcp/${url.port || 443}${url.protocol === 'wss:' ? '/tls' : ''}/ws/p2p/${peerId}`;
}
export const companionAdmissionProtocol = '/workspace/companion-admission/1.0.0';
/** A phone resolves a pairing channel to the laptop advertising it; authentication is end to end. */
export const companionRendezvousProtocol = '/workspace/companion-rendezvous/1.0.0';
