/** Opt-in desktop workflow fixture: encrypted relay/owner, scripted provider transcript, no provider execution. */
import { generateKeyPairFromSeed } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCompanionRelay } from '../relay';
import { CompanionOutboundConnector } from '../connector';
import type { CompanionGateway } from '../gateway';
import { ConversationSource } from '../conversation-source';
import { GuestConversationGateway } from '../../sharing/guest-gateway';
import { ConversationShares } from '../../sharing/conversation-shares';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { conversationShareTarget } from '@workspace/core/conversation-sharing';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { CompanionReset } from '@workspace/core/companion-protocol';

const directory = process.argv[2]!; await mkdir(directory, { recursive: true, mode: 0o700 });
const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
// Stable isolated test relay identity. Never connects to the production relay.
const relay = await createCompanionRelay({ key: await generateKeyPairFromSeed('Ed25519', new Uint8Array(32).fill(73)), listen: `/ip4/127.0.0.1/tcp/${port}/ws` });
const pin = { origin: `ws://127.0.0.1:${port}`, peerId: relay.peerId.toString() };
const key = await generateKeyPairFromSeed('Ed25519', new Uint8Array(32).fill(74)); const ownerId = peerIdFromPrivateKey(key).toString();
const snapshot = createEmptySnapshot();
snapshot.teams = [{ id: 'synthetic', name: 'Synthetic', agentIds: ['shared'] }];
snapshot.agents = [{ id: 'shared', name: 'Synthetic conversation', backend: 'claude', backendSession: { kind: 'claude', sessionId: 'synthetic-session', transport: 'stdio' }, teamId: 'synthetic', folder: '/synthetic', status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now' }];
const guestState = createEmptySnapshot(); guestState.general.providerEnabled = { codex: false, claude: false, antigravity: false };
guestState.general.providerHomes = { codex: { isolated: true, shareSkills: false, homePath: path.join(directory, 'empty-codex') }, claude: { isolated: true, shareSkills: false, homePath: path.join(directory, 'empty-claude') }, antigravity: { isolated: true, shareSkills: false, homePath: path.join(directory, 'empty-antigravity') } };
await writeFile(path.join(directory, 'guest-state.json'), JSON.stringify(guestState), { mode: 0o600 });
const target = conversationShareTarget(snapshot.agents[0]!)!;
const shares = new ConversationShares({ directory: path.join(directory, 'shares'), endpoint: async () => ({ ownerId, relay: pin }) }, () => snapshot, () => {});
const link = (await shares.control({ action: 'create', target })).link!;
const handle = (await shares.control({ action: 'status', target })).state.handle!;
const listeners = new Set<(event: AppBackendEvent) => void>(); let revision = 1; let live = false;
function reset(): CompanionReset { return { type: 'claude.conversationSnapshotChanged', agentId: 'shared', backend: 'claude', backendSessionId: 'synthetic-session', conversationId: 'synthetic-session', seq: revision, occurredAt: '2026-01-01T00:00:00Z', payload: { revision, snapshot: { agentId: 'shared', sessionId: 'synthetic-session', activeTurnId: null, turnIds: [], turns: [], messages: [{ id: 'history', agentId: 'shared', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: live ? 'Synthetic live update after reconnect.' : 'Synthetic history from before sharing. No provider account or repository is needed.' }], createdAt: '2026-01-01T00:00:00Z' }], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } }; }
function emit(event: AppBackendEvent) { source.observe(event); for (const listener of listeners) listener(event); }
const source = new ConversationSource(async () => { emit(reset()); });
const gateway = new GuestConversationGateway({ authorize: (handle, credential) => shares.authorize(handle, credential), connected: (handle, count) => shares.connected(handle, count),
  onEvent: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, synchronize: (agent, checkpoint) => source.synchronize(agent, checkpoint), conversation: agent => source.read(agent),
  loadOlderHistory: async () => ({ hasOlder: false }), readConversationContent: async () => { throw new Error('denied'); }, readImage: async () => { throw new Error('denied'); },
});
const connector = new CompanionOutboundConnector(key, { grants: [], pairingInvitations: () => [] } as unknown as CompanionGateway, { phoneEnabled: () => false, sharing: { handles: () => [handle], accept: (stream, peer) => gateway.accept(stream, peer) } });
await connector.start(pin.origin, pin.peerId);
await writeFile(path.join(directory, 'link.txt'), link, { mode: 0o600 }); await writeFile(path.join(directory, 'relay.json'), JSON.stringify(pin), { mode: 0o600 });
await writeFile(path.join(directory, 'ready'), 'ready');
let lastCommand = '';
const timer = setInterval(async () => {
  let command = ''; try { command = await readFile(path.join(directory, 'command'), 'utf8'); } catch { return; }
  if (command === lastCommand) return; lastCommand = command;
  if (command === 'offline') await connector.stop();
  if (command === 'online') { await connector.start(pin.origin, pin.peerId); live = true; revision++; emit(reset()); }
  if (command === 'revoke') await shares.control({ action: 'revoke', handle, target });
  await writeFile(path.join(directory, 'observation.json'), JSON.stringify({ command, subscriptions: listeners.size, connected: connector.connected, fixtureOnly: true }));
}, 100);
async function close() { clearInterval(timer); gateway.close(); await connector.stop(); shares.close(); await relay.stop(); process.exit(0); }
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
