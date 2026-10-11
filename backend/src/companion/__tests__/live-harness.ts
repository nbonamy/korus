// Opt-in native acceptance harness. Uses one isolated real daemon and real provider authentication.
import { mkdtemp, mkdir, copyFile, chmod, writeFile, readFile, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createServer } from 'node:http';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createAppRpcError, isAppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import { StdioRpcPeer } from '../../stdio';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { createCompanionRelay } from '../relay';
import type { CompanionControlResult } from '@workspace/core/companion-protocol';
import type { AppSnapshot } from '@workspace/core/contracts';

const root = process.cwd();
const evidence = path.join(root, 'mobile/.native-build/evidence');
const tlsDirectory = path.join(root, 'mobile/.native-build/tls');
const home = await mkdtemp(path.join(os.tmpdir(), 'mobile-companion-real-'));
let cleanup = async () => { await rm(home, { recursive: true, force: true }); };
try {
await mkdir(evidence, { recursive: true, mode: 0o700 });
await mkdir(path.join(home, 'codex-home'), { mode: 0o700 });
await copyFile(path.join(os.homedir(), '.korus/codex-home/auth.json'), path.join(home, 'codex-home/auth.json'));
await chmod(path.join(home, 'codex-home/auth.json'), 0o600);
const snapshot = createEmptySnapshot();
snapshot.general.providerEnabled = { codex: true, claude: false, antigravity: false };
snapshot.sourceFolder = { path: root, initialized: true, recentRepoNames: [] };
snapshot.teams = [{ id: 'team-native-check', name: 'Native acceptance', agentIds: ['agent-native-check'] }];
snapshot.agents = [{ id: 'agent-native-check', name: 'Real provider', teamId: 'team-native-check', backend: 'codex', folder: root,
  status: { type: 'idle' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
snapshot.activeTeamId = snapshot.teams[0]!.id; snapshot.activeAgentId = snapshot.agents[0]!.id;
await writeFile(path.join(home, 'state.json'), JSON.stringify(snapshot), { mode: 0o600 });
const log = await open(path.join(evidence, 'real-daemon.log'), 'w', 0o600);
const child = spawn(process.execPath, [path.join(root, 'backend/dist/daemon.mjs'), 'serve'], { env: { ...process.env, APP_HOME: home, APP_HOST: 'web', NODE_EXTRA_CA_CERTS: path.join(tlsDirectory, 'ca.crt') }, stdio: ['ignore', 'ignore', log.fd] });
cleanup = async () => {
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await log.close(); await rm(home, { recursive: true, force: true });
};
let socket: net.Socket | null = null;
for (let attempt = 0; attempt < 200; attempt++) {
  try {
    socket = net.createConnection(path.join(home, 'daemon.sock'));
    await new Promise<void>((resolve, reject) => { socket!.once('connect', resolve); socket!.once('error', reject); });
    break;
  } catch { socket?.destroy(); socket = null; await new Promise<void>((resolve) => setTimeout(resolve, 100)); }
}
if (!socket) throw new Error('Owning daemon did not start.');
const peer = new StdioRpcPeer({ input: socket, output: socket, onMessage: (message) => isAppRpcRequest(message) ? createAppRpcError(message.id, -32601, 'No native desktop callback in isolated harness.') : undefined });
peer.start();
const control = (input: unknown) => peer.request<CompanionControlResult>(backendMethods.companionControl, { input });
const identity = await control({ action: 'status' });
const relay = await createCompanionRelay({ key: await generateKeyPair('Ed25519'), listen: '/ip4/127.0.0.1/tcp/0/tls/ws', hostIds: [identity.status.hostId],
  tls: { cert: await readFile(path.join(tlsDirectory, 'relay.crt'), 'utf8'), key: await readFile(path.join(tlsDirectory, 'relay.key'), 'utf8') } });
const earlierCleanup = cleanup;
cleanup = async () => { await relay.stop(); peer.stop(); socket?.destroy(); await earlierCleanup(); };
const relayPort = relay.getMultiaddrs()[0]!.toString().match(/\/tcp\/(\d+)/)![1];
await control({ action: 'enable', relayOrigin: `wss://localhost:${relayPort}`, relayPeerId: relay.peerId.toString() });
const invitation = await control({ action: 'invite' });
await writeFile(path.join(evidence, 'private-invitation.json'), JSON.stringify(invitation.invitation), { mode: 0o600 });
// An initial real laptop prompt establishes provider-owned conversation state before the phone subscribes.
for (let attempt = 0; attempt < 100; attempt++) {
  const { snapshot } = await peer.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet);
  if (snapshot.providerConnections?.some((provider) => provider.backend === 'codex' && provider.connected)) break;
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
}
await peer.request(backendMethods.agentPromptSend, { agentId: 'agent-native-check', prompt: 'For a native mobile acceptance check, reply exactly READY. Do not invoke tools or change files.' });
const admin = createServer((request, response) => {
  void (async () => {
    if (request.headers.origin) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/status') {
      const result = await control({ action: 'status' });
      const state = await peer.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet);
      response.end(JSON.stringify({ status: result.status, agents: state.snapshot.agents.map(({ id, status, backendSession }) => ({ id, status, backendSession })) }));
    } else if (request.url === '/approve' && request.method === 'POST') {
      const pending = (await control({ action: 'status' })).status.pending[0];
      if (!pending) throw new Error('No pending phone');
      await control({ action: 'decide', pendingId: pending.id, approve: true, teamIds: ['team-native-check'], canSend: true });
      response.end(JSON.stringify({ approved: true }));
    } else if (request.url === '/invite' && request.method === 'POST') {
      const result = await control({ action: 'invite' });
      await writeFile(path.join(evidence, 'private-invitation.json'), JSON.stringify(result.invitation), { mode: 0o600 }); response.end(JSON.stringify({ created: true }));
    } else if (request.url === '/revoke' && request.method === 'POST') {
      const device = (await control({ action: 'status' })).status.devices[0]; if (!device) throw new Error('No paired phone');
      await control({ action: 'revoke', peerId: device.peerId }); response.end(JSON.stringify({ revoked: true }));
    } else { response.statusCode = 404; response.end('{}'); }
  })().catch(() => { response.statusCode = 500; response.end(JSON.stringify({ error: 'Harness operation failed.' })); });
});
await new Promise<void>((resolve) => admin.listen(0, '127.0.0.1', resolve));
await writeFile(path.join(evidence, 'private-runtime.json'), JSON.stringify({ home, relayPort, adminPort: (admin.address() as net.AddressInfo).port, daemonPid: child.pid }), { mode: 0o600 });
process.stdout.write(`Real companion harness ready; daemon, relay and admin ownership recorded in ignored evidence.\n`);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  admin.closeAllConnections(); await new Promise<void>((resolve) => admin.close(() => resolve()));
  await relay.stop(); peer.stop(); socket?.destroy(); child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await log.close(); await rm(home, { recursive: true, force: true });
  await rm(path.join(evidence, 'private-invitation.json'), { force: true });
  await rm(path.join(evidence, 'private-runtime.json'), { force: true });
}
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });

} catch { await cleanup(); throw new Error('Native acceptance harness failed; its isolated daemon and authentication were cleaned up.'); }
