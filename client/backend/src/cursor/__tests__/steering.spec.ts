import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { companionSessionId } from '@workspace/core/companion-protocol';
import type { Agent } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendEvent, BackendSendResult } from '@workspace/core/backend-driver';
import { BackendDriverRpc, createBackendDriver } from '../../driver-rpc';

let root: string, host: AgentBackendDriver, rpc: BackendDriverRpc, agent: Agent;
let enabled: boolean | undefined, events: BackendEvent[];
const preflight = vi.fn();
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-steering-'));
  vi.stubEnv('HOME', root); vi.stubEnv('PATH', root); vi.stubEnv('SHELL', path.join(root, 'missing-shell'));
  vi.stubEnv('CURSOR_API_KEY', '');
  // Reuse the ACP fixture, adding a controllable cancellation-fence response in this private process only.
  const fixture = await readFile(new URL('./fixtures/acp-agent.cjs', import.meta.url), 'utf8');
  await writeFile(path.join(root, 'fixture.cjs'), fixture.replace("else if (value.method === 'session/list') reply(", `else if (value.method === 'session/list' && fs.existsSync(path.join(__dirname,'hold-fence'))) {
    log({fixture:'fence-held'});
    const watcher=fs.watch(__dirname,()=>{if(fs.existsSync(path.join(__dirname,'release-fence'))) {watcher.close();reply({sessions:[]});}});
  } else if (value.method === 'session/list') reply(`).replace("else if (value.method === 'session/set_config_option') {", `else if (value.method === 'session/set_config_option') {
    if(fs.existsSync(path.join(__dirname,'hold-config'))) {
      log({fixture:'config-held'});
      const watcher=fs.watch(__dirname,()=>{if(fs.existsSync(path.join(__dirname,'release-config'))) {watcher.close();configOptions=configOptions.map(option=>({...option,currentValue:option.id===value.params.configId?value.params.value:option.currentValue}));reply({configOptions});}});return;
    }`));
  await writeFile(path.join(root, 'agent'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(root, 'fixture.cjs'))});\n`);
  await chmod(path.join(root, 'agent'), 0o700);
  await writeFile(path.join(root, 'version'), '2026.11.05-86047df');
  agent = { ...createInitialSnapshot().agents[0]!, id: 'steering', backend: 'cursor', backendDefaults: { kind: 'cursor' }, backendSession: undefined, folder: root };
  enabled = undefined; events = []; preflight.mockReset();
  host = createBackendDriver('cursor', { cursorSteeringFallbackEnabled: () => enabled === true });
  host.onEvent(event => events.push(event));
  rpc = new BackendDriverRpc(new Map([['cursor', host]]), undefined, preflight);
});
afterEach(async () => { await rpc.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
async function wire(): Promise<Record<string, any>[]> {
  return (await readFile(path.join(root, 'wire.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
const completed = () => events.filter(event => event.type === 'cursor.conversationEventReceived' && event.payload.event.type === 'turn.completed');
async function start() {
  const result = await rpc.handle('driver/prompt/send', { agent, prompt: 'wait' }) as BackendSendResult;
  agent.backendSession = result.backendSession;
  await vi.waitFor(async () => expect((await wire()).filter(call => call.fixture === 'prompt-admission')).toHaveLength(1));
  return result;
}
const steer = (options?: unknown) => rpc.handle('driver/prompt/steer', { agent, prompt: 'Correction', expectedSessionId: companionSessionId(agent), options }) as Promise<BackendSendResult>;

describe('opt-in Cursor interrupt-and-resend steering', () => {
  it.each([undefined, false])('rejects disabled steering before preflight or native work (enabled=%s)', async value => {
    enabled = value;
    if (value === undefined) {
      await rpc.close(); host = createBackendDriver('cursor');
      rpc = new BackendDriverRpc(new Map([['cursor', host]]), undefined, preflight);
    }
    expect(rpc.getCapabilities(agent).steerPrompt).toBe(false);
    expect(host.getRuntimeStatus().capabilities?.steerPrompt).toBe(false);
    await expect(steer()).rejects.toThrow(/does not support prompt steering/);
    await expect(host.steerPrompt!(agent, 'Correction')).rejects.toThrow(/steering/i);
    expect(preflight).not.toHaveBeenCalled();
    expect(await wire()).toStrictEqual([]);
  });
  it.each(['opt-out', 'release'] as const)('revalidates %s after asynchronous resend preparation', async change => {
    enabled = true; await start();
    await writeFile(path.join(root, 'hold-config'), '');
    const pending = steer({ selection: { model: 'composer-2.5' } }).catch((error: unknown) => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.fixture === 'config-held')).toBe(true));
    if (change === 'opt-out') enabled = false;
    else await host.releaseConversation!(agent.id);
    await writeFile(path.join(root, 'release-config'), '');
    expect(await pending).toBeInstanceOf(Error);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
  });
  it('requires a saved running turn instead of creating a conversation for steering', async () => {
    enabled = true;
    await expect(steer()).rejects.toThrow(/session|turn/i);
    expect(await wire()).toStrictEqual([]);
    await start();
    agent.folder = path.dirname(root);
    await expect(steer()).rejects.toThrow(/workspace/i);
    expect((await wire()).filter(call => call.method === 'session/cancel')).toStrictEqual([]);
  });
  it('settles and fences the old turn before resending attachments and selection in the same session', async () => {
    enabled = true;
    expect(rpc.getCapabilities(agent).steerPrompt).toBe(true);
    expect(host.getRuntimeStatus().capabilities?.steerPrompt).toBe(true);
    const first = await start();
    await writeFile(path.join(root, 'context.txt'), 'ATTACHMENT_MARKER');
    const next = await steer({ attachments: [{ type: 'file', path: path.join(root, 'context.txt'), name: 'context.txt' }], selection: { model: 'composer-2.5' }, planMode: true });
    await vi.waitFor(() => expect(completed()).toHaveLength(2));
    expect(next.backendSession).toStrictEqual(first.backendSession);
    expect(next.turnId).not.toBe(first.turnId);
    const calls = await wire(), methods = calls.map(call => call.method).filter(Boolean);
    expect(methods.filter(method => method === 'session/new')).toHaveLength(1);
    expect(methods.indexOf('session/cancel')).toBeLessThan(methods.indexOf('session/list'));
    expect(methods.indexOf('session/list')).toBeLessThan(methods.lastIndexOf('session/prompt'));
    const prompts = calls.filter(call => call.method === 'session/prompt');
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1].params.prompt)).toContain('ATTACHMENT_MARKER');
    expect(calls.filter(call => call.method === 'session/set_config_option').map(call => call.params)).toEqual(expect.arrayContaining([{ sessionId: first.backendSession.kind === 'cursor' ? first.backendSession.sessionId : '', configId: 'model', value: 'composer-2.5' }, { sessionId: first.backendSession.kind === 'cursor' ? first.backendSession.sessionId : '', configId: 'mode', value: 'plan' }]));
    await host.loadConversation!(agent);
    const frame = events.filter(event => event.type === 'cursor.conversationSnapshotChanged').at(-1);
    if (frame?.type !== 'cursor.conversationSnapshotChanged') throw new Error('Missing snapshot');
    expect(frame.payload.snapshot.turns.map(turn => turn.status)).toStrictEqual(['interrupted', 'completed']);
    expect(JSON.stringify(frame.payload.snapshot.messages)).toContain('context.txt');
    expect(JSON.stringify(frame.payload.snapshot.messages)).not.toContain('LATE');
    enabled = false;
    expect(rpc.getCapabilities(agent).steerPrompt).toBe(false);
    expect(host.getRuntimeStatus().capabilities?.steerPrompt).toBe(false);
    await expect(steer()).rejects.toThrow(/does not support/);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(2);
  });
  it.each(['opt-out', 'session', 'workspace', 'release', 'account', 'close'] as const)('rejects %s changes while the cancellation fence is pending', async change => {
    enabled = true; await start();
    await writeFile(path.join(root, 'hold-fence'), '');
    const pending = steer().catch((error: unknown) => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.fixture === 'fence-held')).toBe(true));
    await expect(steer()).rejects.toThrow(/steer|operation/i);
    if (change === 'opt-out') enabled = false;
    if (change === 'session') agent.backendSession = { kind: 'cursor', sessionId: 'different-session' };
    if (change === 'workspace') agent.folder = path.dirname(root);
    if (change === 'release') await host.releaseConversation!(agent.id);
    if (change === 'close') await host.close();
    if (change === 'account') {
      await writeFile(path.join(root, 'status.json'), JSON.stringify({ isAuthenticated: false }));
      await host.authenticate!({ action: 'check' });
    }
    await writeFile(path.join(root, 'release-fence'), '');
    expect(await pending).toBeInstanceOf(Error);
    expect((await pending as Error).message).toMatch(/steer|released|closed|identity|workspace|session/i);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    if (change === 'opt-out') {
      enabled = true;
      await rm(path.join(root, 'hold-fence'));
      await host.sendPrompt(agent, 'wait');
      await vi.waitFor(async () => expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(2));
      await steer();
      await vi.waitFor(() => expect(completed()).toHaveLength(3));
    }
  });
});
