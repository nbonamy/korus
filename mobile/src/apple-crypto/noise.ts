import { serviceCapabilities, UnexpectedPeerError } from '@libp2p/interface';
import type { ComponentLogger, ConnectionEncrypter, MessageStream, PrivateKey, SecureConnectionOptions, Upgrader } from '@libp2p/interface';
import { peerIdFromPublicKey } from '@libp2p/peer-id';
import { lpStream } from '@libp2p/utils';
import { createHandshakePayload, decodeHandshakePayload } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/utils.js';
import { uint16BEDecode, uint16BEEncode } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/encoder.js';
import { publicKeyFromProtobuf } from './keys';
import { appleCrypto, decode, encode } from './bridge';
import { AppleEncryptedStream } from './stream';

type Components = { privateKey: PrivateKey; logger: ComponentLogger; upgrader: Upgrader };
/** Wire-compatible /noise; the upstream XX/cipher state lives in the native service, never this WebView. */
export function noise(): (components: Components) => ConnectionEncrypter {
  return components => ({
    protocol: '/noise', [serviceCapabilities]: ['@libp2p/connection-encryption', '@chainsafe/libp2p-noise'],
    secureOutbound: (connection, options) => secure(components, connection, true, options),
    secureInbound: (connection, options) => secure(components, connection, false, options),
  });
}
async function secure(components: Components, connection: MessageStream, initiator: boolean, options?: SecureConnectionOptions) {
  options?.signal?.throwIfAborted();
  const session = await appleCrypto<{ id: string; publicKey: string }>({ op: 'create', initiator });
  const call = (op: string, data?: Uint8Array) => appleCrypto<{ data: string; remoteStatic: string }>({ op, id: session.id, ...(data ? { data: encode(data) } : {}) });
  try {
    options?.signal?.throwIfAborted();
    const framed = lpStream(connection, { lengthEncoder: uint16BEEncode, lengthDecoder: data => uint16BEDecode(data.subarray()), maxDataLength: 65535 });
    // Leave stream-muxer negotiation to libp2p after encryption. No early negotiation extensions.
    const payload = await createHandshakePayload(components.privateKey, decode(session.publicKey), { streamMuxers: [], webtransportCerthashes: [] });
    let received;
    if (initiator) {
      await framed.write(decode((await call('writeA')).data), options);
      const response = await call('readB', (await framed.read(options)).subarray());
      received = await decodeHandshakePayload(decode(response.data), decode(response.remoteStatic), options?.remotePeer?.publicKey);
      const remote = peerIdFromPublicKey(publicKeyFromProtobuf(received.identityKey));
      if (options?.remotePeer && !options.remotePeer.equals(remote)) throw new UnexpectedPeerError('Unexpected encrypted peer');
      await framed.write(decode((await call('writeC', payload.subarray())).data), options);
    } else {
      await call('readA', (await framed.read(options)).subarray());
      await framed.write(decode((await call('writeB', payload.subarray())).data), options);
      const response = await call('readC', (await framed.read(options)).subarray());
      received = await decodeHandshakePayload(decode(response.data), decode(response.remoteStatic), options?.remotePeer?.publicKey);
    }
    const remotePeer = peerIdFromPublicKey(publicKeyFromProtobuf(received.identityKey));
    if (options?.remotePeer && !options.remotePeer.equals(remotePeer)) throw new UnexpectedPeerError('Unexpected encrypted peer');
    await call('split'); options?.signal?.throwIfAborted();
    return { connection: new AppleEncryptedStream(framed.unwrap(), session.id), remotePeer, remoteExtensions: received.extensions };
  } catch (error) {
    connection.abort(error as Error);
    await appleCrypto({ op: 'close', id: session.id }).catch(() => {});
    throw error;
  }
}
