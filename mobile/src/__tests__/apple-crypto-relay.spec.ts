import { describe, expect, it, vi } from 'vitest';
import { noise as nodeNoise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import type { Libp2pOptions } from 'libp2p';
import { companionResponseLimit, companionUpdatesProtocol, encodeCompanionFrame, readCompanionFrames } from '@workspace/core/companion-protocol';
import { codexConversationSnapshot, codexTextMessage } from '../../../vue/src/test/codex-conversation-fixtures';
import { cryptoFixture } from './apple-crypto-fixture';
import { createRelayConnector } from '../relay-connector';

// The iOS Vite build substitutes this adapter. Keep the real connector's transport
// configuration and use ordinary Node Noise at the independent desktop and relay.
vi.mock('libp2p', async importOriginal => {
  const actual = await importOriginal<typeof import('libp2p')>();
  return { ...actual, createLibp2p: async (options: Libp2pOptions) => {
    const { noise } = await import('../apple-crypto/noise');
    return actual.createLibp2p({ ...options, connectionEncrypters: [noise()] });
  } };
});

describe('Apple companion over a real relay', () => {
  it('loads history larger than the paused buffer through both encrypted layers with a slow native decryptor', async () => {
    const native = await cryptoFixture();
    const { createLibp2p } = await vi.importActual<typeof import('libp2p')>('libp2p');
    const relay = await createLibp2p({ addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] }, transports: [webSockets()],
      connectionEncrypters: [nodeNoise()], streamMuxers: [yamux()], services: { identify: identify(), relay: circuitRelayServer({
        reservations: { defaultDataLimit: 64n * 1024n * 1024n, defaultDurationLimit: 600_000 },
      }) } });
    const relayAddress = relay.getMultiaddrs()[0]!;
    const desktop = await createLibp2p({ addresses: { listen: [`${relayAddress}/p2p-circuit`] },
      transports: [webSockets(), circuitRelayTransport()], connectionEncrypters: [nodeNoise()], streamMuxers: [yamux()], services: { identify: identify() } });
    const relayConfig = { origin: `ws://127.0.0.1:${relayAddress.toString().match(/\/tcp\/(\d+)/)![1]}`, peerId: relay.peerId.toString(), allowLocalDevelopment: true };
    const hostId = desktop.peerId.toString();
    const values = new Map([['paired-hosts', JSON.stringify([{ v: 1, relayOrigin: relayConfig.origin, relayPeerId: relayConfig.peerId, hostId, name: 'Fixture laptop' }])]]);
    const connector = createRelayConnector({ read: async ({ key }) => ({ value: values.get(key) ?? null }),
      write: async ({ key, value }) => { values.set(key, value); }, remove: async ({ key }) => { values.delete(key); } }, relayConfig);
    const text = 'history '.repeat(800_000);
    const frame = { type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'agent', threadId: 'thread', seq: 1, occurredAt: '',
      payload: { revision: 1, snapshot: { ...codexConversationSnapshot([codexTextMessage('large', 'assistant', text)]), historyState: { hasOlder: false, loadingOlder: false } } } };
    const workspace = { repositoryIcons: {}, teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', teamId: 'team', backend: 'codex', name: 'Agent', folder: null,
      status: { type: 'idle' }, backendSession: { kind: 'codex', threadId: 'thread' }, createdAt: '', updatedAt: '' }] };
    const failures: string[] = [];
    const serving = new Set<Promise<void>>();
    vi.stubGlobal('window', { webkit: { messageHandlers: { native: { postMessage: async ({ command }: any) => {
      if (command.op === 'decrypt') await new Promise(resolve => setTimeout(resolve, 3));
      return native.call(command);
    } } } } });
    try {
      await desktop.handle(companionUpdatesProtocol, stream => {
        stream.maxWriteBufferLength = companionResponseLimit + 4;
        let seq = 0;
        const send = async (value: unknown) => { if (!stream.send(encodeCompanionFrame(value, companionResponseLimit))) await stream.onDrain(); };
        const run = (async () => {
          try {
            for await (const raw of readCompanionFrames(stream)) {
              const call = raw as { id: string; method: string };
              if (call.method === 'snapshot.get') await send({ v: 1, seq: ++seq, update: { type: 'workspace', workspace } });
              if (call.method === 'conversation.subscribe') await send({ v: 1, seq: ++seq, update: { type: 'conversation', frame } });
              await send({ v: 1, id: call.id, result: call.method === 'snapshot.get' ? workspace : {} });
            }
          } catch { /* Fixture shutdown closes its streams. */ }
        })();
        serving.add(run); void run.finally(() => serving.delete(run));
      }, { runOnLimitedConnection: true });
      await connector.initialize!();
      const session = await connector.connect(hostId);
      session.onDisconnect(() => { failures.push('disconnected'); });
      expect(await session.getWorkspace()).toStrictEqual(workspace);
      const received = await session.loadConversation('agent');
      expect(failures).toStrictEqual([]);
      expect(received).not.toBeNull();
      expect(received).toStrictEqual(frame);
      expect(failures).toStrictEqual([]);
      // The same encrypted circuit is still usable after the large transfer.
      expect(await session.getWorkspace()).toStrictEqual(workspace);
      expect(failures).toStrictEqual([]);
    } finally {
      await connector.dispose!();
      await Promise.all([desktop.stop(), relay.stop()]);
      await Promise.allSettled([...serving]);
      await native.close(); vi.unstubAllGlobals();
    }
  }, 45000);
});
