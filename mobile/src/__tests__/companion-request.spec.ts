import { describe, expect, it } from 'vitest';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { CompanionFrameDecoder, companionProtocol, companionMaxUploadBytes, encodeCompanionFrame } from '@workspace/core/companion-protocol';
import { requestCompanionStream } from '../companion-request';

describe('companion request transport', () => {
  it('delivers the maximum allowed upload over real Noise and Yamux backpressure', async () => {
    const options = { transports: [webSockets()], connectionEncrypters: [noise()], streamMuxers: [yamux()] };
    const laptop = await createLibp2p({ ...options, addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] } });
    let phone: Awaited<ReturnType<typeof createLibp2p>> | undefined;
    try {
      await laptop.handle(companionProtocol, async stream => {
        const decoder = new CompanionFrameDecoder();
        for await (const chunk of stream) for (const raw of decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())) {
          const call = raw as { id: string; args: { attachments: { data: string }[] } };
          const data = Buffer.from(call.args.attachments[0]!.data, 'base64');
          stream.send(encodeCompanionFrame({ v: 1, id: call.id, result: { bytes: data.length, lastByte: data.at(-1) } }));
          await stream.close(); return;
        }
      });
      phone = await createLibp2p(options);
      const stream = await phone.dialProtocol(laptop.getMultiaddrs()[0]!, companionProtocol);
      expect(await requestCompanionStream(stream, 'prompt.submit', { attachments: [{ data: Buffer.alloc(companionMaxUploadBytes, 7).toString('base64') }] }))
        .toStrictEqual({ bytes: companionMaxUploadBytes, lastByte: 7 });
    } finally { await phone?.stop(); await laptop.stop(); }
  });
});
