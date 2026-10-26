import { GuestJoins } from '../sharing/guest-joins';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BackendDriverRpc } from '../driver-rpc';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';
import { conversationShareTarget, decodeConversationShareLink } from '@workspace/core/conversation-sharing';
import type { ConversationShareResult } from '@workspace/core/conversation-sharing';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { product } from '@workspace/core/product';

// Failure modes: duplicate/racing creates, failed writes, restart, stale session,
// remote host, stale revoke, or diagnostics/events accidentally carrying a bearer.
const relay = product.companionRelay!;
const ownerId = '12D3KooWJ7cStPD8Mq1nJKegq5nTXWmKkRZAfkQxBBDQvhfHE3Ej';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'conversation-sharing-')); roots.push(root);
  const snapshot = createTestSnapshot();
  snapshot.agents = [{ id: 'agent', teamId: 'team-test', name: 'Synthetic owner', backend: 'codex', folder: '/fixture', backendSession: { kind: 'codex', threadId: 'original' }, status: { type: 'idle' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' }];
  snapshot.teams[0]!.agentIds = ['agent'];
  const events: AppBackendEvent[] = [];
  const directory = path.join(root, 'shares');
  const start = (driverRpc?: BackendDriverRpc) => new AppBackendServer({ driverRpc, version: 'test', snapshot, onEvent: event => events.push(event), conversationSharing: { directory, endpoint: async () => ({ ownerId, relay }) } });
  const target = conversationShareTarget(snapshot.agents[0]!)!;
  const request = async (server: AppBackendServer, input: unknown) => {
    const response = await server.handleMessage({ jsonrpc: '2.0', id: 'share', method: 'conversation/share/control', params: { input } });
    if (!response || 'error' in response) throw new Error(JSON.stringify(response));
    return response.result as ConversationShareResult;
  };
  return { root, directory, snapshot, events, start, target, request };
}
describe('owner conversation sharing RPC and protected persistence', () => {
  it('serves guest navigation RPCs with no provider, team or repository and rejects unscoped guest content reads', async () => {
    const f = await fixture();
    const joins = new GuestJoins({ directory: path.join(f.root, 'guest'), relay });
    const server = new AppBackendServer({ version: 'test', snapshot: createEmptySnapshot(), guestJoins: joins });
    const call = (method: string, params: unknown) => server.handleMessage({ jsonrpc: '2.0', id: 'guest', method, params });
    try {
      expect(await call('client/guest/conversation/control', { input: { action: 'state' } })).toStrictEqual({ jsonrpc: '2.0', id: 'guest', result: { entries: [], view: null } });
      expect(await call('client/guest/conversation/control', { input: { action: 'prepare', link: 'invalid' } })).toMatchObject({ result: { entries: [], view: { status: 'invalid' } } });
      expect(await call('client/guest/conversation/control', { input: { action: 'owner/prompt', credential: 'PRIVATE' } })).toMatchObject({ error: { message: 'Guest operation failed. Check local storage and try again.' } });
      for (const method of ['client/guest/conversation/image', 'client/guest/conversation/content']) expect(await call(method, { id: 'a'.repeat(64), path: '/private', input: {} })).toMatchObject({ error: { message: 'Guest operation failed. Check local storage and try again.' } });
      expect((await joins.control({ action: 'state' })).entries).toHaveLength(0);
    } finally { await server.close(); }
  });
  it.each(['create', 'copy'] as const)('refuses %s when the bound session changes during route publication', async action => {
    const f = await fixture(); let blocked = false;
    let started!: () => void; const publishing = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const server = new AppBackendServer({ version: 'test', snapshot: f.snapshot, conversationSharing: {
      directory: f.directory, endpoint: async () => ({ ownerId, relay }), routing: {
        subscribe: () => () => {},
        update: async routes => { if (blocked && routes.length) { started(); await gate; } return 'ready'; },
      },
    } });
    try {
      if (action === 'copy') await f.request(server, { action: 'create', target: f.target });
      blocked = true;
      const result = f.request(server, { action, target: f.target });
      const outcome = result.then(() => ({ rejected: false, message: '' }), error => ({ rejected: true, message: error instanceof Error ? JSON.parse(error.message).error.message as string : '' }));
      await publishing;
      f.snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'replacement-during-network' };
      release();
      expect(await outcome).toStrictEqual({ rejected: true, message: 'Conversation changed. Reopen Share.' });
      const status = await f.request(server, { action: 'status', target: conversationShareTarget(f.snapshot.agents[0]!)! });
      expect(status.state.active).toBe(false);
    } finally { release(); await server.close(); }
  });
  it('advertises only saved active routes after restart and withdraws them before revoke returns', async () => {
    const f = await fixture(); let statusListener: ((value: import('@workspace/core/conversation-share-relay').ShareRoutingStatus) => void) | undefined;
    let status: import('@workspace/core/conversation-share-relay').ShareRoutingStatus = 'ready';
    const routes: unknown[][] = [];
    const routing = {
      update: vi.fn(async (value: unknown[]) => {
        // The protected file already exists whenever a new handle is advertised.
        if (value.length) expect(JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8')).links.some((link: { revokedAt?: string }) => !link.revokedAt)).toBe(true);
        routes.push(value); return status;
      }),
      subscribe: (listener: typeof statusListener) => { statusListener = listener; return () => { statusListener = undefined; }; },
    };
    const start = () => new AppBackendServer({ version: 'test', snapshot: f.snapshot, onEvent: event => f.events.push(event), conversationSharing: { directory: f.directory, endpoint: async () => ({ ownerId, relay }), routing } });
    let server = start();
    try {
      const created = await f.request(server, { action: 'create', target: f.target });
      expect(created.state.availability).toBe('ready');
      expect(routes.at(-1)).toStrictEqual([{ ownerId, relay, handle: created.state.handle }]);
      expect(JSON.stringify(routes)).not.toContain(decodeConversationShareLink(created.link!, relay)!.credential);
      await server.close(); server = start(); await server.initialize();
      expect(routes.at(-1)).toStrictEqual([{ ownerId, relay, handle: created.state.handle }]);
      status = 'capacity'; statusListener?.(status);
      expect((await f.request(server, { action: 'copy', target: f.target })).state.availability).toBe('capacity');
      expect((await f.request(server, { action: 'copy', target: f.target })).link === created.link).toBe(true);
      await f.request(server, { action: 'revoke', target: f.target, handle: created.state.handle });
      expect(routes.at(-1)).toStrictEqual([]);
      await server.close(); server = start(); await server.initialize();
      expect(routes.at(-1)).toStrictEqual([]);
    } finally { await server.close(); }
  });
  it('reuses one link across duplicate create/copy and restart, then permanently revokes it', async () => {
    const f = await fixture(); let server = f.start();
    try {
      const [first, duplicate] = await Promise.all([f.request(server, { action: 'create', target: f.target }), f.request(server, { action: 'create', target: f.target })]);
      expect(duplicate.link === first.link).toBe(true);
      expect(duplicate.state).toStrictEqual(first.state);
      const alias = { ...f.snapshot.agents[0]!, id: 'same-conversation-alias' };
      f.snapshot.agents.push(alias);
      expect((await f.request(server, { action: 'create', target: conversationShareTarget(alias)! })).link === first.link).toBe(true);
      const decoded = decodeConversationShareLink(first.link!, relay)!;
      expect(decoded.ownerId).toBe(ownerId);
      expect(decoded.credential.length).toBe(43);
      const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
      expect(saved.links).toHaveLength(1);
      expect(saved.links[0].target).toStrictEqual(f.target);
      expect((await stat(path.join(f.directory, 'state.json'))).mode & 0o777).toBe(0o600);
      expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
      expect(JSON.stringify(f.events)).not.toContain(decoded.credential);
      expect(JSON.stringify(f.events)).not.toContain(first.link);
      await server.close(); server = f.start();
      expect((await f.request(server, { action: 'copy', target: f.target })).link === first.link).toBe(true);
      const status = await f.request(server, { action: 'status', target: f.target });
      expect(status.link).toBeUndefined();
      const [stopped, replacement] = await Promise.all([
        f.request(server, { action: 'revoke', target: f.target, handle: first.state.handle }),
        f.request(server, { action: 'create', target: f.target }),
      ]);
      expect(stopped.state.active).toBe(false);
      expect(replacement.link === first.link).toBe(false);
      await expect(f.request(server, { action: 'revoke', target: f.target, handle: first.state.handle })).rejects.toThrow();
      expect((await f.request(server, { action: 'copy', target: f.target })).link === replacement.link).toBe(true);
      await server.close(); server = f.start();
      expect((await f.request(server, { action: 'copy', target: f.target })).link === replacement.link).toBe(true);
      const restored = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
      expect(restored.links.find((link: { handle: string }) => link.handle === decoded.handle).revokedAt).toEqual(expect.any(String));
    } finally { await server.close(); }
  });
  it('invalidates a replaced or deleted target and excludes remote conversations', async () => {
    const f = await fixture(); const server = f.start();
    try {
      await f.request(server, { action: 'create', target: f.target });
      f.snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'replacement' };
      await expect(f.request(server, { action: 'copy', target: f.target })).rejects.toThrow();
      const nextTarget = conversationShareTarget(f.snapshot.agents[0]!)!;
      expect((await f.request(server, { action: 'status', target: nextTarget })).state.active).toBe(false);
      f.snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'original' };
      expect((await f.request(server, { action: 'status', target: f.target })).state.active).toBe(false);
      f.snapshot.teams[0]!.remoteConnectionId = 'remote-host';
      await expect(f.request(server, { action: 'create', target: f.target })).rejects.toThrow();
      delete f.snapshot.teams[0]!.remoteConnectionId;
      f.snapshot.agents = [];
      await expect(f.request(server, { action: 'create', target: f.target })).rejects.toThrow();
    } finally { await server.close(); }
  });
  it('revokes on session reset before the original session can be restored', async () => {
    const f = await fixture(); const server = f.start();
    try {
      const first = await f.request(server, { action: 'create', target: f.target });
      const reset = await server.handleMessage({ jsonrpc: '2.0', id: 'reset', method: 'agent/conversation/reset', params: { agentId: 'agent' } });
      expect(reset).not.toHaveProperty('error');
      f.snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'original' };
      const status = await f.request(server, { action: 'status', target: f.target });
      expect(status.state.active).toBe(false);
      const next = await f.request(server, { action: 'create', target: f.target });
      expect(next.link === first.link).toBe(false);
    } finally { await server.close(); }
  });
  it('does not rearm links after rapid provider session replacement events', async () => {
    const f = await fixture(); let publish!: (event: BackendEvent) => void;
    const driver: AgentBackendDriver = {
      backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'original' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'original' } }),
      respondToAgentRequest: async () => undefined, close: async () => undefined,
      onEvent: listener => { publish = listener; return () => {}; },
    };
    const server = f.start(new BackendDriverRpc(new Map([['codex', driver]])));
    try {
      await f.request(server, { action: 'create', target: f.target });
      publish({ type: 'agent.conversationAttached', agentId: 'agent', backend: 'codex', conversationId: 'replacement', payload: {} });
      publish({ type: 'agent.conversationAttached', agentId: 'agent', backend: 'codex', conversationId: 'original', payload: {} });
      expect((await f.request(server, { action: 'status', target: f.target })).state.active).toBe(false);
    } finally { await server.close(); }
  });
  it('keeps the existing credential when a revoke write fails and exposes no success', async () => {
    const f = await fixture(); const server = f.start();
    try {
      const first = await f.request(server, { action: 'create', target: f.target });
      // ENOTDIR is portable even when tests run as an administrator.
      const { rename } = await import('node:fs/promises');
      await rename(f.directory, `${f.directory}-backup`); await writeFile(f.directory, 'blocked');
      await expect(f.request(server, { action: 'revoke', target: f.target, handle: first.state.handle })).rejects.toThrow('Share storage is unavailable');
      await rm(f.directory); await rename(`${f.directory}-backup`, f.directory);
      expect((await f.request(server, { action: 'copy', target: f.target })).link === first.link).toBe(true);
    } finally { await server.close(); }
  });
  it('does not impose a fifty-conversation limit', async () => {
    const f = await fixture(); const server = f.start();
    try {
      const agent = f.snapshot.agents[0]!;
      for (let i = 0; i < 51; i++) {
        const next = { ...agent, id: `agent-${i}`, backendSession: { kind: 'codex' as const, threadId: `thread-${i}` } };
        f.snapshot.agents.push(next);
        await f.request(server, { action: 'create', target: conversationShareTarget(next)! });
      }
      const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
      expect(saved.links.filter((link: { revokedAt?: string }) => !link.revokedAt)).toHaveLength(51);
    } finally { await server.close(); }
  });
  it('fails closed on inaccessible or corrupt storage without returning a link or secrets', async () => {
    const f = await fixture(); await writeFile(f.directory, 'not a directory'); let server = f.start();
    try {
      await expect(f.request(server, { action: 'create', target: f.target })).rejects.toThrow('Share storage is unavailable');
      expect(f.events).toHaveLength(0);
      await server.close(); await rm(f.directory); await mkdir(f.directory);
      await writeFile(path.join(f.directory, 'state.json'), '{broken-secret'); server = f.start();
      await expect(f.request(server, { action: 'create', target: f.target })).rejects.toThrow('Share storage is unavailable');
    } finally { await server.close(); }
  });
});
