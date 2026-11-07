import { mkdtemp, copyFile, chmod, writeFile, readFile, rm, access, symlink, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendDriverRpc, createBackendDriver } from '../../driver-rpc';
import { AppBackendServer } from '../../server';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { isCursorSnapshot, isCursorEvent } from '@workspace/core/cursor-conversation-guards';
import type { CursorConversationSnapshot } from '@workspace/core/contracts/cursor-conversation';
import { UsageLedger } from '../../usage/usage-ledger';
import { UsageService } from '../../usage/usage-service';
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return {...actual,open:vi.fn(actual.open),realpath:vi.fn(actual.realpath)}; });
let root: string, host: AgentBackendDriver;
let events: BackendEvent[];
const observedPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII=';
const agent = { ...createInitialSnapshot().agents[0]!, id: 'cursor-fixture', backend: 'cursor' as const, backendDefaults: { kind: 'cursor' as const }, backendSession: undefined };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-host-'));
  vi.stubEnv('HOME', root); vi.stubEnv('PATH', root); vi.stubEnv('SHELL', path.join(root, 'missing-shell')); vi.stubEnv('CURSOR_API_KEY', 'synthetic-must-not-leak');
  await copyFile(new URL('./fixtures/acp-agent.cjs', import.meta.url), path.join(root, 'fixture.cjs'));
  await writeFile(path.join(root, 'agent'), `#!${process.execPath}\nrequire(${JSON.stringify(path.join(root, 'fixture.cjs'))});\n`);
  await chmod(path.join(root, 'agent'), 0o700);
  await writeFile(path.join(root, 'version'), '2026.10.22-27dcf5f');
  agent.folder = root; events = []; host = createBackendDriver('cursor'); host.onEvent(event => events.push(event));
});
afterEach(async () => { vi.useRealTimers(); await host.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const completions = () => events.filter(event => event.type === 'cursor.conversationEventReceived' && event.payload.event.type === 'turn.completed');
async function snapshot(): Promise<CursorConversationSnapshot> {
  await host.loadConversation!(agent);
  const frame = events.filter(event => event.type === 'cursor.conversationSnapshotChanged').at(-1);
  if (frame?.type !== 'cursor.conversationSnapshotChanged') throw new Error('No Cursor snapshot');
  expect(isCursorSnapshot(frame.payload.snapshot)).toBe(true);
  return frame.payload.snapshot;
}
async function wire() { return (await readFile(path.join(root, 'wire.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
describe('Cursor ACP host transport boundary', () => {
  it('records completed, interrupted and failed native executions without inventing tokens or costs or counting snapshot reads', async () => {
    const ledger = new UsageLedger(path.join(root, 'usage.sqlite'));
    const usage = new UsageService(ledger, () => agent);
    await ledger.load();
    expect(host.onUsage).toBeTypeOf('function');
    const unsubscribeUsage = host.onUsage!(event => usage.observe(event));
    const unsubscribeEvents = host.onEvent(event => usage.observeEvent(event as never));
    try {
      await host.sendPrompt(agent, 'hello');
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      await snapshot(); await snapshot();
      const waiting = { ...agent, id: 'waiting' };
      const turn = await host.sendPrompt(waiting, 'wait');
      await host.interrupt(waiting, turn.turnId);
      await host.sendPrompt({ ...agent, id: 'failed' }, 'eof');
      await vi.waitFor(() => expect(completions()).toHaveLength(3));
      const released = { ...agent, id: 'released' };
      await host.sendPrompt(released, 'wait');
      await host.releaseConversation!(released.id);
      await vi.waitFor(() => expect(completions()).toHaveLength(4));
      await usage.drain();
      expect(ledger.query({ provider: 'cursor' }).rows).toMatchObject([{
        started: 4, completed: 1, interrupted: 2, failed: 1, inProgress: 0, measuredTurns: 0, tokens: null,
        cost: { usd: null, coverage: 'unavailable' },
      }]);
      // Projection is local; the uploader negotiates collector acceptance.
      expect(ledger.projectDailyTelemetry({ day: new Date().toISOString().slice(0, 10) })).toMatchObject([{provider: 'cursor', model: 'unknown', turns: 4, measuredTurns: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null, costCoverage: 'unavailable'}]);
      await usage.close();
      const restored = new UsageLedger(path.join(root, 'usage.sqlite'));
      try {
        await restored.load();
        expect(restored.query({ provider: 'cursor' }).rows).toMatchObject([{ started: 4, completed: 1, interrupted: 2, failed: 1 }]);
      } finally { await restored.close(); }
    } finally { unsubscribeUsage(); unsubscribeEvents(); await usage.close(); }
  });
  it('cold loads native history once without executing or counting replay, then continues that session', async () => {
    const observations: unknown[] = []; host.onUsage!(event => observations.push(event));
    const saved = { ...agent, backendSession: { kind: 'cursor' as const, sessionId: 'saved-session' } };
    await host.loadConversation!(saved);
    await host.loadConversation!(saved);
    const frames = events.filter(event => event.type === 'cursor.conversationSnapshotChanged');
    const state = frames.at(-1)!.payload as { snapshot: CursorConversationSnapshot };
    expect(state.snapshot).toMatchObject({ sessionId: 'saved-session', busy: false, turns: [{ status: 'completed', startedAt: null, completedAt: null, durationMs: null }] });
    expect(state.snapshot.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(state.snapshot.messages.every(message => message.createdAt === '')).toBe(true);
    expect(JSON.stringify(state.snapshot)).toContain('Remember synthetic marker');
    expect(JSON.stringify(state.snapshot)).toContain('replay-tool');
    expect(observations).toStrictEqual([]);
    expect(completions()).toStrictEqual([]);
    expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
    expect((await wire()).some(call => call.method === 'session/new')).toBe(false);
    await host.sendPrompt(saved, 'continue');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect(observations).toHaveLength(2);
  });
  it('rejects missing or foreign-workspace native history before load and never creates a replacement', async () => {
    for (const sessionId of ['missing-session', 'foreign-session']) {
      await expect(host.loadConversation!({ ...agent, backendSession: { kind: 'cursor', sessionId } })).rejects.toThrow(/missing|workspace/i);
    }
    expect((await wire()).some(call => ['session/new', 'session/load', 'session/prompt'].includes(call.method))).toBe(false);
  });
  it('uses native model values, rejects unknown models and applies selection before prompt', async () => {
    expect(await host.listModels!(agent)).toMatchObject([{ id: 'auto', displayName: 'Auto' }, { id: 'composer-2.5', displayName: 'Composer' }]);
    await expect(host.sendPrompt(agent, 'bad', { selection: { model: 'invented' } })).rejects.toThrow(/model/i);
    for (const configOptions of [[], [{id:'model',currentValue:'auto'}], [{id:'another-model',currentValue:'composer-2.5'}]]) {
      await writeFile(path.join(root,'model-ack.json'),JSON.stringify({configOptions}));
      await expect(host.sendPrompt(agent,'must-not-run',{selection:{model:'composer-2.5'}})).rejects.toThrow(/model/i);
      expect((await wire()).some(call => call.method === 'session/prompt')).toBe(false);
    }
    await rm(path.join(root,'model-ack.json'));
    await host.sendPrompt(agent, 'hello', { selection: { model: 'composer-2.5' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const calls = await wire();
    const setter = calls.findIndex(call => call.method === 'session/set_config_option');
    expect(calls[setter].params).toMatchObject({ configId: 'model', value: 'composer-2.5' });
    expect(setter).toBeLessThan(calls.findIndex(call => call.method === 'session/prompt'));
  });
  it('embeds trusted UTF-8 files and images and rejects binary files before prompt admission', async () => {
    const text = path.join(root, 'notes.txt'); const image = path.join(root, 'sample.png'); const binary = path.join(root, 'binary');
    await writeFile(text, 'ATTACHMENT_MARKER'); await writeFile(image, Buffer.from([137,80,78,71,13,10,26,10])); await writeFile(binary, Buffer.from([0,1,2]));
    await expect(host.sendPrompt(agent, 'bad', { attachments: [{ type: 'file', path: binary }] })).rejects.toThrow(/binary/i);
    await host.sendPrompt(agent, 'hello', { attachments: [{ type: 'file', path: text }, { type: 'image', path: image }] });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const prompts = (await wire()).filter(call => call.method === 'session/prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].params.prompt.slice(1)).toStrictEqual([
      { type: 'resource', resource: { uri: new URL(`file://${text}`).href, mimeType: 'text/plain', text: 'ATTACHMENT_MARKER' } },
      { type: 'image', mimeType: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') },
    ]);
  });
  it('restores presentation and attachments after close/load without exposing developer context', async () => {
    const file = path.join(root, 'notes.txt'), image = path.join(root, 'picture.png'); await writeFile(file, 'MARKER');
    await writeFile(image, Buffer.from([137,80,78,71,13,10,26,10]));
    const first = await host.sendPrompt(agent, 'My prompt', { attachments: [{ type: 'file', path: file }, { type: 'image', path: image, mimeType: 'image/png' }] });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const liveUser = (await snapshot()).messages.find(message => message.role === 'user')!;
    expect(liveUser.parts).toContainEqual({ type: 'attachment', attachment: { kind: 'file', name: 'notes.txt', path: file } });
    await host.close(); host = createBackendDriver('cursor'); events = []; host.onEvent(event => events.push(event));
    const saved = { ...agent, backendSession: first.backendSession };
    await host.loadConversation!(saved);
    const frame = events.find(event => event.type === 'cursor.conversationSnapshotChanged')!;
    if (frame.type !== 'cursor.conversationSnapshotChanged') throw new Error('No snapshot');
    const user = frame.payload.snapshot.messages.find(message => message.role === 'user')!;
    expect(user.parts).toStrictEqual(liveUser.parts);
    expect(user.parts.filter(part => part.type === 'attachment')).toHaveLength(2);
    expect(JSON.stringify(frame)).not.toContain('<context');
    expect(user.createdAt).toBe('');
  });
  it('lists workspace history without creating a session and explicitly resumes only idle validated targets', async () => {
    const history = await host.listConversations!(agent, { searchTerm: 'saved', limit: 1 });
    expect(history).toMatchObject([{ sessionId: 'saved-session', updatedAt: '', ref: { backend: 'cursor', folder: root, sessionId: 'saved-session' } }]);
    expect((await wire()).some(call => call.method === 'session/new')).toBe(false);
    await expect(host.resumeConversation!(agent, { ref: { backend: 'cursor', folder: root, sessionId: 'foreign-session' }, storageState: 'active' })).rejects.toThrow(/workspace/);
    const resumed = await host.resumeConversation!(agent, { ref: history[0]!.ref, storageState: 'active' });
    expect(resumed.backendSession).toStrictEqual({ kind: 'cursor', sessionId: 'saved-session' });
    const active = await host.sendPrompt({ ...agent, backendSession: resumed.backendSession }, 'wait');
    await expect(host.resumeConversation!(agent, { ref: history[0]!.ref, storageState: 'active' })).rejects.toThrow(/current|finish/i);
    await host.interrupt(agent, active.turnId);
  });
  it('cancels an explicit resume during replay without adopting its session', async () => {
    await writeFile(path.join(root, 'hold-load'), '');
    const pending = host.resumeConversation!(agent, { ref: { backend: 'cursor', folder: root, sessionId: 'saved-session' }, storageState: 'active' }).catch(error => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.method === 'session/load')).toBe(true));
    await host.releaseConversation!(agent.id);
    expect(await pending).toBeInstanceOf(Error);
    expect(events.filter(event => event.type === 'cursor.conversationSnapshotChanged')).toStrictEqual([]);
  });
  it('reads validated stored messages without replacing the live session or emitting execution frames', async () => {
    const first = await host.sendPrompt(agent, 'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const before = events.length; const observations: unknown[] = []; host.onUsage!(value => observations.push(value));
    const messages = await host.readConversationMessages!({backend:'cursor',folder:root,sessionId:'saved-session'},agent.id);
    expect(JSON.stringify(messages)).toContain('Remember synthetic marker');
    expect(events.slice(before).filter(event => event.type.startsWith('cursor.'))).toStrictEqual([]);
    expect(observations).toStrictEqual([]);
    await expect(host.readConversationMessages!({backend:'cursor',folder:root,sessionId:'foreign-session'},agent.id)).rejects.toThrow(/workspace/i);
    await host.sendPrompt({...agent,backendSession:first.backendSession},'continue'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
  });
  it.each([
    {isAuthenticated:false},
    {isAuthenticated:true,userInfo:{email:'new@example.invalid',teamName:'First'}},
    {isAuthenticated:true,userInfo:{email:'first@example.invalid',teamName:'Second'}},
  ])('invalidates cached sessions and pending callbacks on observed authentication identity changes (%j)', async status => {
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:true,userInfo:{email:'first@example.invalid',teamName:'First'}}));
    await host.sendPrompt(agent,'extension');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    const request = (await snapshot()).clientRequests[0]!;
    await writeFile(path.join(root,'status.json'),JSON.stringify(status));
    await host.authenticate!({action:'check'});
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await snapshot()).clientRequests).toStrictEqual([]);
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'decision',decision:'allow'}})).rejects.toThrow(/pending/i);
    await expect(host.sendPrompt(agent,'must-not-run')).rejects.toThrow(/closed|reconnect/i);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
  });
  it('preserves the signed-out replica and rehydrates only the saved same-account reference after explicit sign-in', async () => {
    const loggedIn = {isAuthenticated:true,userInfo:{email:'owner@example.invalid',teamName:'Team'}};
    await writeFile(path.join(root,'status.json'),JSON.stringify(loggedIn));
    const first = await host.sendPrompt(agent,'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const saved = {...agent,backendSession:first.backendSession};
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:false})); await host.authenticate!({action:'check'});
    const before = await snapshot();
    await expect(host.sendPrompt(saved,'signed-out')).rejects.toThrow(/sign in|disconnected/i);
    expect((await snapshot()).messages).toStrictEqual(before.messages);
    await writeFile(path.join(root,'status.json'),JSON.stringify(loggedIn)); await host.authenticate!({action:'check'});
    await expect(host.sendPrompt(agent,'missing-reference')).rejects.toThrow(/closed|reference/i);
    await host.sendPrompt(saved,'recovered'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    expect((await wire()).filter(call => call.method === 'session/load')).toHaveLength(1);
    await writeFile(path.join(root,'status.json'),JSON.stringify({isAuthenticated:true,userInfo:{email:'other@example.invalid',teamName:'Team'}})); await host.authenticate!({action:'check'});
    await expect(host.sendPrompt(saved,'wrong-account')).rejects.toThrow(/account|identity/i);
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(2);
  });
  it('selects catalog plan mode before a prompt and restores agent mode for the following normal prompt', async () => {
    const first = await host.sendPrompt(agent,'hello',{planMode:true}); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    await host.sendPrompt({...agent,backendSession:first.backendSession},'normal'); await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const calls = (await wire()).filter(call => call.method === 'session/set_config_option' || call.method === 'session/prompt');
    expect(calls.map(call => [call.method,call.params.value ?? call.params.prompt[0].text.split('\n')[0]])).toStrictEqual([
      ['session/set_config_option','plan'],['session/prompt','hello'],['session/set_config_option','agent'],['session/prompt','normal'],
    ]);
  });
  it('rejects plan mode missing from the native catalog without sending a prompt', async () => {
    await writeFile(path.join(root,'no-plan'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/plan|mode/i);
    expect((await wire()).some(call => call.method === 'session/prompt')).toBe(false);
  });
  it('fails closed on a mode acknowledgment that disagrees and rechecks authoritative mode after a model change', async () => {
    await writeFile(path.join(root,'bad-mode-ack'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/mode|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    await rm(path.join(root,'bad-mode-ack'));
    await host.sendPrompt(agent,'hello',{planMode:true,selection:{model:'composer-2.5'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(agent,'again',{planMode:true,selection:{model:'auto'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && call.params.configId==='mode').map(call=>call.params.value)).toStrictEqual(['plan','plan','plan']);
  });
  it('rejects an empty mode acknowledgment before prompt admission', async () => {
    await writeFile(path.join(root,'no-mode-ack'),'');
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true})).rejects.toThrow(/mode|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('preserves edit changes, locations, resource text and images through live output and cold replay', async () => {
    const first = await host.sendPrompt(agent,'rich-output'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    const verify = (state: CursorConversationSnapshot) => {
      expect(state.turns.at(-1)?.status).toBe('completed');
      const parts = state.messages.flatMap(message=>message.parts);
      const tool = parts.find(part=>part.type==='tool' && part.title==='Edit note.txt');
      expect(tool).toMatchObject({statusText:JSON.stringify({source:'cursor',action:'edit',phase:'completed',params:{target:'note.txt',path:'note.txt'}}),kind:'fileChange',status:'completed',input:{path:'note.txt'},output:{native:'retained'},metadata:{cwd:root,locations:[{path:'note.txt',line:2}],changes:[{path:'note.txt',kind:'update',oldText:'before\nlast line',newText:'after\nlast line\n'}]}});
      if (tool?.type !== 'tool') throw new Error('No edit tool');
      expect(tool.metadata).toStrictEqual({cursorToolKind:'edit',cwd:root,locations:[{path:'note.txt',line:2}],changes:[{path:'note.txt',kind:'update',oldText:'before\nlast line',newText:'after\nlast line\n'}]});
      expect(parts).toContainEqual(expect.objectContaining({type:'tool',title:'Delete removed.txt',metadata:expect.objectContaining({changes:[{path:'removed.txt',kind:'delete',oldText:'gone',newText:''}]})}));
      expect(parts).toContainEqual(expect.objectContaining({type:'tool',title:'Write added.txt',metadata:expect.objectContaining({changes:[{path:'added.txt',kind:'add',oldText:null,newText:'created'}]})}));
      expect(tool.body).toContain('before'); expect(tool.body).toContain('after'); expect(tool.body).toContain('RESOURCE_MARKER');
      expect(parts.filter(part=>part.type==='media').map(part=>part.type==='media' && part.media.url)).toStrictEqual(['data:image/png;base64,iVBORw0KGgo=','data:image/png;base64,iVBORw0KGgo=']);
      expect(parts).toContainEqual({type:'text',text:'Rich output complete'});
    };
    verify(await snapshot());
    await host.close(); host=createBackendDriver('cursor'); events=[]; host.onEvent(event=>events.push(event));
    await host.loadConversation!({...agent,backendSession:first.backendSession});
    verify(await snapshot());
  });
  it.each([false,true])('observes a validated workspace image without claiming generated success (notification=%s)', async notification => {
    const image=path.join(root,'observed.png'); await writeFile(image,Buffer.from(observedPng,'base64'));
    await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:image,notification}));
    await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='media')).toStrictEqual([{type:'media',itemId:'cursor-file:native-image',media:{url:`data:image/png;base64,${observedPng}`,mimeType:'image/png',alt:'Image file',title:'Image file'}}]);
    expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='tool')).toContainEqual(expect.objectContaining({status:'failed',output:{native:'unchanged'}}));
    if (!notification) await vi.waitFor(async()=>expect((await wire()).find(call=>call.id===5 && call.result)?.result).toStrictEqual({outcome:{outcome:'cancelled'}}));
  });
  it.each(['missing','outside','symlink','directory','binary','oversized'])('does not display an unverified %s image path', async kind => {
    const outside=await mkdtemp(path.join(tmpdir(),'cursor-image-outside-'));
    try {
      let file=path.join(root,'unverified.png');
      if (kind==='outside' || kind==='symlink') { const target=path.join(outside,'image.png'); await writeFile(target,Buffer.from('iVBORw0KGgo=','base64')); if(kind==='outside') file=target; else await symlink(target,file); }
      if (kind==='directory') await mkdir(file);
      if (kind==='binary') await writeFile(file,'not an image');
      if (kind==='oversized') await writeFile(file,Buffer.alloc(5*1024*1024+1));
      vi.mocked(realpath).mockClear();
      await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:file}));
      await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect((await snapshot()).messages.flatMap(message=>message.parts).filter(part=>part.type==='media')).toStrictEqual([]);
      if(kind==='outside') expect(vi.mocked(realpath).mock.calls.filter(([requested])=>requested===file)).toStrictEqual([]);
    } finally { await rm(outside,{recursive:true,force:true}); }
  });
  it.each(['symlink-swap','release'])('drops an image observation after %s during the open/read boundary', async action => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const image=path.join(root,'delayed.png'), outside=await mkdtemp(path.join(tmpdir(),'cursor-image-race-'));
    let reached=false, resumeRead!:()=>void;
    const resume=new Promise<void>(resolve=>{resumeRead=resolve;});
    await writeFile(image,Buffer.from(observedPng,'base64'));
    await writeFile(path.join(root,'image-event.json'),JSON.stringify({filePath:image,notification:true}));
    vi.mocked(open).mockImplementation(async (file,flags,mode)=>{ const handle=await actual.open(file,flags,mode); if(path.basename(String(file))==='delayed.png'){reached=true;await resume;} return handle; });
    try {
      await host.sendPrompt(agent,'image-observation'); await vi.waitFor(()=>expect(reached).toBe(true));
      let closing:Promise<void>|undefined;
      if(action==='release') closing=host.releaseConversation!(agent.id) as Promise<void>;
      else { const target=path.join(outside,'outside.png'); await writeFile(target,Buffer.from(observedPng,'base64')); await rm(image); await symlink(target,image); }
      resumeRead(); await closing;
      if(action!=='release') await vi.waitFor(()=>expect(completions()).toHaveLength(1));
      expect(events.flatMap(event=>event.type==='cursor.conversationEventReceived' && event.payload.event.type==='message.upsert' ? event.payload.event.payload.message.parts : []).filter(part=>part.type==='media')).toStrictEqual([]);
    } finally {resumeRead();vi.mocked(open).mockImplementation(actual.open);await rm(outside,{recursive:true,force:true});}
  });
  it('discovers model-specific enum effort and admits only exact native config IDs/values without changing thinking', async () => {
    await writeFile(path.join(root,'rich-models'),'');
    const models=await host.listModels!(agent);
    expect(models.find(model=>model.id==='fixture-alpha')).toMatchObject({defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'extra-high'}]});
    expect(models.find(model=>model.id==='fixture-thinking')?.supportedReasoningEfforts).toBeUndefined();
    expect(models.find(model=>model.id==='auto')?.supportedReasoningEfforts).toBeUndefined();
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-beta',reasoningEffort:'xhigh'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    await host.sendPrompt(agent,'hello',{selection:{model:'fixture-dual',reasoningEffort:'low'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(3));
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{model:'fixture-alpha',reasoningEffort:'xhigh'}})).rejects.toThrow(/effort|reasoning/i);
    const setters=(await wire()).filter(call=>call.method==='session/set_config_option' && !['model','mode'].includes(call.params.configId));
    expect(setters.map(call=>[call.params.configId,call.params.value])).toStrictEqual([['reasoning','extra-high'],['reasoning_effort','xhigh'],['effort','low']]);
    expect((await wire()).filter(call=>call.method==='cursor/list_available_models')).toHaveLength(1);
    const prompts=(await wire()).filter(call=>call.method==='session/prompt').length;
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{serviceTier:'fast'}})).rejects.toThrow(/tier/i);
    expect((await wire()).filter(call=>call.method==='session/prompt')).toHaveLength(prompts);
  });
  it('clears inherited effort on model changes and honors explicit null without resetting native thought settings', async () => {
    await writeFile(path.join(root,'rich-models'),'');
    const defaults={...agent,backendDefaults:{kind:'cursor' as const,model:'fixture-alpha',reasoningEffort:'extra-high'}};
    await host.sendPrompt(defaults,'hello'); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    await host.sendPrompt(defaults,'hello',{selection:{reasoningEffort:null}}); await vi.waitFor(()=>expect(completions()).toHaveLength(2));
    await host.sendPrompt(defaults,'hello',{selection:{model:'fixture-beta'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(3));
    await writeFile(path.join(root,'native-thinking-change'),'');
    const dual={...agent,backendDefaults:{kind:'cursor' as const,model:'fixture-dual'}};
    await host.sendPrompt(dual,'hello'); await vi.waitFor(()=>expect(completions()).toHaveLength(4));
    await host.sendPrompt(dual,'hello',{selection:{reasoningEffort:null}}); await vi.waitFor(()=>expect(completions()).toHaveLength(5));
    expect((await wire()).filter(call=>call.fixture==='prompt-admission').map(call=>({model:call.model,thoughts:call.thoughts}))).toStrictEqual([
      {model:'fixture-alpha',thoughts:{reasoning:'extra-high'}},{model:'fixture-alpha',thoughts:{reasoning:'extra-high'}},{model:'fixture-beta',thoughts:{reasoning_effort:'medium'}},
      {model:'fixture-dual',thoughts:{thinking:'false',effort:'high'}},{model:'fixture-dual',thoughts:{thinking:'true',effort:'high'}},
    ]);
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && !['model','mode'].includes(call.params.configId)).map(call=>[call.params.configId,call.params.value])).toStrictEqual([['reasoning','extra-high']]);
  });
  it.each(['empty','value','config-id','model','model-id','model-category'])('rejects a contradictory %s reasoning acknowledgment before prompt admission', async mismatch => {
    await writeFile(path.join(root,'rich-models'),'');
    if(mismatch==='model-id') await writeFile(path.join(root,'missing-live-model-id'),'');
    const configOptions=mismatch==='empty'?[]:[{...(mismatch==='model-id'?{}:{id:'model'}),category:mismatch==='model-category'?'other':'model',type:'select',currentValue:mismatch==='model'?'fixture-beta':'fixture-alpha',options:[{value:'fixture-alpha',name:'Alpha'}]}, {id:mismatch==='config-id'?'effort':'reasoning',category:'thought_level',type:'select',currentValue:mismatch==='value'?'low':'extra-high',options:[{value:'low',name:'Low'},{value:'extra-high',name:'Extra high'}]}];
    await writeFile(path.join(root,'effort-ack.json'),JSON.stringify({configOptions}));
    await expect(host.sendPrompt(agent,'must-not-run',{selection:{...(mismatch==='model-id'?{}:{model:'fixture-alpha'}),reasoningEffort:'extra-high'}})).rejects.toThrow(/effort|reasoning|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('falls back only on method-not-found and derives current-model effort from live configuration', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'catalog-error.json'),JSON.stringify({code:-32601,message:'private-native-detail'}));
    const models=await host.listModels!(agent);
    expect(models.find(model=>model.id==='fixture-alpha')).toMatchObject({supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'extra-high'}]});
    expect(models.find(model=>model.id==='fixture-beta')?.supportedReasoningEfforts).toBeUndefined();
    await host.sendPrompt(agent,'hello',{selection:{reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
  });
  it.each(['rpc','malformed'])('does not hide a %s catalog failure as an old-CLI fallback', async failure => {
    await writeFile(path.join(root,failure==='rpc'?'catalog-error.json':'catalog-result.json'),JSON.stringify(failure==='rpc'?{code:-32000,message:'private-native-detail'}:{models:[{value:'bad',name:'Bad',configOptions:'invalid'}]}));
    await expect(host.listModels!(agent)).rejects.toThrow(/Cursor/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private-native-detail');
  });
  it('cancels held reasoning discovery without attaching an agent snapshot', async () => {
    await writeFile(path.join(root,'hold-model-catalog'),'');
    const pending=host.listModels!(agent).catch(error=>error);
    await vi.waitFor(async()=>expect((await wire()).some(call=>call.method==='cursor/list_available_models')).toBe(true));
    await host.releaseConversation!(agent.id); expect(await pending).toBeInstanceOf(Error);
    expect(events.filter(event=>event.type==='cursor.conversationSnapshotChanged')).toStrictEqual([]);
  });
  it('keeps a failed effort acknowledgment untrusted until model selection is confirmed again', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'effort-ack.json'),JSON.stringify({configOptions:[]}));
    await expect(host.sendPrompt(agent,'bad',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}})).rejects.toThrow(/reasoning/);
    await rm(path.join(root,'effort-ack.json'));
    await expect(host.sendPrompt(agent,'must-not-run')).rejects.toThrow(/confirm|configuration/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
    await host.sendPrompt(agent,'recovered',{selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).filter(call=>call.method==='session/set_config_option' && call.params.configId==='model')).toHaveLength(1);
  });
  it('validates plan mode after effort has changed authoritative mode metadata', async () => {
    await writeFile(path.join(root,'rich-models'),''); await writeFile(path.join(root,'effort-resets-mode'),'');
    await host.sendPrompt(agent,'hello',{planMode:true,selection:{model:'fixture-beta',reasoningEffort:'xhigh'}}); await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).filter(call=>call.method==='session/set_config_option').map(call=>[call.params.configId,call.params.value])).toStrictEqual([['model','fixture-beta'],['reasoning_effort','xhigh'],['mode','plan']]);
  });
  it.each(['model','effort'])('rejects a final mode acknowledgment that changes the requested %s', async mismatch => {
    await writeFile(path.join(root,'rich-models'),'');
    await writeFile(path.join(root,'mode-selection-ack.json'),JSON.stringify({configOptions:[
      {id:'mode',category:'mode',currentValue:'plan',options:[{value:'plan',name:'Plan'},{value:'agent',name:'Agent'}]},
      {id:'model',category:'model',currentValue:mismatch==='model'?'fixture-beta':'fixture-alpha',options:[{value:'fixture-alpha',name:'Alpha'}]},
      {id:'reasoning',category:'thought_level',type:'select',currentValue:mismatch==='effort'?'low':'extra-high',options:[{value:'low',name:'Low'},{value:'extra-high',name:'Extra high'}]},
    ]}));
    await expect(host.sendPrompt(agent,'must-not-run',{planMode:true,selection:{model:'fixture-alpha',reasoningEffort:'extra-high'}})).rejects.toThrow(/model|reasoning|selection|confirm/i);
    expect((await wire()).some(call=>call.method==='session/prompt')).toBe(false);
  });
  it('switches an untouched agent to Cursor through the app boundary and accepts its first prompt', async () => {
    const state = createTestSnapshot();
    state.agents = [{ ...agent, backend: 'codex', backendDefaults: { kind: 'codex', model: 'must-not-leak' }, backendSession: undefined }];
    state.teams[0]!.agentIds = [agent.id]; state.teams[0]!.activeAgentId = agent.id; state.activeAgentId = agent.id;
    state.providerConnections = [{ backend: 'cursor', installed: true, connected: true, checking: false }];
    const server = new AppBackendServer({ version: 'fixture', snapshot: state, driverRpc: new BackendDriverRpc(new Map([['cursor', host]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'agent/update', params: { input: { id: agent.id, selection: { backend: 'cursor' } } } });
      expect(state.agents[0]).toMatchObject({ backend: 'cursor', backendDefaults: { kind: 'cursor' } });
      expect(state.agents[0]!.backendDefaults?.model).toBeUndefined();
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'hello', expectedSessionId: null } });
      await vi.waitFor(() => expect(completions()).toHaveLength(1));
      expect(state.agents[0]!.backendSession).toMatchObject({ kind: 'cursor' });
      expect(state.agents[0]!.status.type).toBe('idle');
    } finally { await server.close(); }
  });
  it('starts two independent agents without sharing transcripts or failing a concurrent auth check', async () => {
    const second = { ...agent, id: 'second-cursor-agent' };
    const results = await Promise.all([host.sendPrompt(agent, 'hello'), host.sendPrompt(second, 'hello')]);
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect(results[0]!.backendSession).not.toEqual(results[1]!.backendSession);
    await host.loadConversation!(second);
    const frames = events.filter(event => event.type === 'cursor.conversationSnapshotChanged');
    expect(frames.at(-1)).toMatchObject({ agentId: second.id, payload: { snapshot: { agentId: second.id } } });
  });
  it('handshakes, streams split text/thought/tool frames and serializes two prompts with developer context', async () => {
    const first = await host.sendPrompt(agent, 'hello');
    const second = await host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'again');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['completed', 'completed']);
    expect(state.messages.flatMap(message => message.parts).filter(part => part.type === 'text')).toContainEqual({ type: 'text', text: 'Hello Cursor' });
    expect(state.messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', title: 'Read synthetic.txt', status: 'completed', body: 'synthetic contents' }));
    expect(second.backendSession).toEqual(first.backendSession);
    const calls = await wire();
    expect(calls.slice(0, 3).map(call => call.method)).toEqual(['initialize', 'authenticate', 'session/new']);
    expect(calls[0].params.clientCapabilities).toEqual({ _meta: { parameterizedModelPicker: true } });
    expect(calls[1].params).toEqual({ methodId: 'cursor_login' });
    expect(calls[2].params).toEqual({ cwd: root, mcpServers: [] });
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain('<context id=');
    expect(calls.find(call => call.method === 'session/prompt').params.prompt[0].text).toContain(`agent ID is ${agent.id}`);
    expect(host.getCapabilities(agent)).toMatchObject({ interrupt: true, approvals: false, history: true, models: true });
  });
  it('denies permissions using the native reject option and keeps a completed-but-rejected tool visibly failed', async () => {
    await host.sendPrompt(agent, 'permission');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    await host.respondToAgentRequest({ id: (await snapshot()).clientRequests[0]!.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'deny' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 1 && call.result)?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } });
    await expect(access(path.join(root, 'should-not-exist'))).rejects.toThrow();
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({ type: 'tool', status: 'failed', body: expect.stringMatching(/denied/i) }));
  });
  it('exposes a once-only plan decision and cancels pending callbacks on interruption', async () => {
    const first = await host.sendPrompt(agent, 'extension');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    const request = (await snapshot()).clientRequests[0]!;
    await expect(host.respondToAgentRequest({ id: request.id, agentId: 'wrong', outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow(/pending/i);
    await host.respondToAgentRequest({ id: request.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'allow' } });
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 2 && call.result)?.result).toStrictEqual({ outcome: { outcome: 'accepted' } });
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',status:'completed',metadata:expect.objectContaining({plan:'# Synthetic plan',todos:[]})}));
    for (const event of events) if (event.type === 'cursor.conversationEventReceived') expect(isCursorEvent(event.payload.event)).toBe(true);
    await expect(host.respondToAgentRequest({ id: request.id, agentId: agent.id, outcome: { kind: 'decision', decision: 'allow' } })).rejects.toThrow(/pending/i);
    const next = await host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'extension');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    await host.interrupt(agent, next.turnId);
    expect((await snapshot()).clientRequests).toStrictEqual([]);
  });
  it('maps documented question choices back to exact native IDs and cancels unanswered questions on release', async () => {
    await host.sendPrompt(agent,'question');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    const request = (await snapshot()).clientRequests[0]!;
    expect(request).toMatchObject({kind:'ask_user',payload:{request:{questions:[{id:'mode',options:[{label:'Fast'},{label:'Safe'}]},{id:'extras',multiSelect:true}]}}});
    expect((await wire()).find(call => call.id === 6 && call.result)?.result).toStrictEqual({outcome:{outcome:'accepted',todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}]}});
    expect((await wire()).find(call => call.id === 7 && call.result)?.result).toStrictEqual({outcome:{outcome:'cancelled'}});
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({todos:[{id:'todo-1',content:'Choose mode',status:'in_progress'}]})}));
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'answered',answers:{mode:{answers:['invented']},extras:{answers:['one-id']}}}})).rejects.toThrow(/choice|answer/i);
    await host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'answered',answers:{mode:{answers:['Fast']},extras:{answers:['one-id','two-id']}}}});
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await wire()).find(call => call.id === 4 && call.result)?.result).toStrictEqual({outcome:{outcome:'answered',answers:[{questionId:'mode',selectedOptionIds:['fast-id']},{questionId:'extras',selectedOptionIds:['one-id','two-id']}]}});
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({todos:[{id:'todo-1',content:'Choose mode',status:'completed'}]})}));
    expect((await snapshot()).messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({type:'tool',metadata:expect.objectContaining({planEntries:[{content:'Choose mode',priority:'medium',status:'in_progress'}]})}));
    await expect(host.respondToAgentRequest({id:request.id,agentId:agent.id,outcome:{kind:'cancelled'}})).rejects.toThrow(/pending/i);
    await host.sendPrompt(agent,'question');
    await vi.waitFor(async () => expect((await snapshot()).clientRequests).toHaveLength(1));
    const next = (await snapshot()).clientRequests[0]!;
    await host.releaseConversation!(agent.id);
    await expect(host.respondToAgentRequest({id:next.id,agentId:agent.id,outcome:{kind:'answered',answers:{}}})).rejects.toThrow(/pending/i);
  });
  it('preapproves only observed app MCP calls in the active turn without persistent permissions', async () => {
    await host.close(); host = createBackendDriver('cursor', { appMcpServerUrl: 'http://127.0.0.1:1234/mcp' }); host.onEvent(event => events.push(event));
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify({}));
    const first = await host.sendPrompt(agent,'mcp-permission');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect((await snapshot()).clientRequests).toStrictEqual([]);
    expect(events.some(event=>event.type==='cursor.conversationEventReceived' && event.payload.event.type==='request.created')).toBe(false);
    expect((await wire()).find(call=>call.id===8&&call.result)?.result).toStrictEqual({outcome:{outcome:'selected',optionId:'native-mcp-once'}});
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify({omitObservation:true}));
    await host.sendPrompt({...agent,backendSession:first.backendSession},'mcp-permission');
    await vi.waitFor(async()=>expect((await snapshot()).clientRequests).toHaveLength(1));
    await host.respondToAgentRequest({agentId:agent.id,id:(await snapshot()).clientRequests[0]!.id,outcome:{kind:'decision',decision:'deny'}});
    await vi.waitFor(()=>expect(completions()).toHaveLength(2));
  });
  it.each([
    {name:'another MCP server with a Korus-looking title',config:{input:{providerIdentifier:'external',toolName:'set-status'}}},
    {name:'shell with Korus-shaped arguments',config:{kind:'execute'}},
    {name:'missing observed tool identity',config:{omitObservation:true}},
    {name:'contradictory request identity',config:{requestInput:{providerIdentifier:'external',toolName:'set-status'}}},
    {name:'no once-only option',config:{noOnce:true}},
    {name:'no app gateway',config:{},noGateway:true},
    {name:'duplicate server identity',config:{},duplicate:true},
  ])('keeps manual permission for $name', async ({config,noGateway,duplicate}) => {
    await host.close(); host = createBackendDriver('cursor', { ...(!noGateway?{appMcpServerUrl:'http://127.0.0.1:1234/mcp'}:{}), ...(duplicate?{hostedMcpServerUrls:()=>({korus:'http://127.0.0.1:1235/mcp'})}:{}) }); host.onEvent(event=>events.push(event));
    await writeFile(path.join(root,'mcp-permission.json'),JSON.stringify(config));
    await host.sendPrompt(agent,'mcp-permission');
    await vi.waitFor(async()=>expect((await snapshot()).clientRequests).toHaveLength(1));
    await host.respondToAgentRequest({agentId:agent.id,id:(await snapshot()).clientRequests[0]!.id,outcome:{kind:'decision',decision:'deny'}});
    await vi.waitFor(()=>expect(completions()).toHaveLength(1));
    expect((await wire()).find(call=>call.id===8&&call.result)?.result).toStrictEqual({outcome:{outcome:'selected',optionId:'native-mcp-reject'}});
  });
  it('binds each supplied app and hosted MCP bridge to its owning agent', async () => {
    await host.close(); host = createBackendDriver('cursor', { appMcpServerUrl: 'http://127.0.0.1:1234/mcp', hostedMcpServerUrls: () => ({ synthetic: 'http://127.0.0.1:1235/mcp' }) });
    const second = { ...agent, id: 'other-agent' };
    await host.listModels!(agent); await host.listModels!(second);
    const calls = (await wire()).filter(call => call.method === 'session/new');
    expect(calls).toHaveLength(2);
    for (const [index, owner] of [agent.id, second.id].entries()) {
      expect(calls[index].params.mcpServers.map((server: {env: {name:string;value:string}[]}) => new URL(server.env.find(env => env.name === 'KORUS_ACP_MCP_URL')!.value).searchParams.get('agentId'))).toStrictEqual([owner, owner]);
    }
  });
  it('interrupts once, ignores stale completion/chunks, and admits the next prompt', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    await vi.waitFor(() => expect(events.some(event => event.type === 'cursor.conversationEventReceived' && event.payload.event.type === 'message.upsert' && JSON.stringify(event.payload.event).includes('Hello'))).toBe(true));
    await host.interrupt(agent, first.turnId);
    await host.interrupt(agent, first.turnId);
    const continued = await host.continueInterruptedTurn!({ ...agent, backendSession: first.backendSession });
    expect(continued.backendSession).toStrictEqual(first.backendSession);
    expect(continued.activeTurnId).toBeTypeOf('string');
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await wire()).filter(call => call.method === 'session/new')).toHaveLength(1);
    const state = await snapshot();
    expect(state.turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
    expect(JSON.stringify(state)).not.toContain('LATE');
    expect((await wire()).find(call => call.id === 3 && call.result)?.result).toEqual({ outcome: { outcome: 'cancelled' } });
  });
  it.each(['eof', 'protocol', 'team', 'team-stderr', 'policy', 'policy-stderr', 'invalid-completion'])('turns %s into a terminal replica and a safe disconnected observation', async input => {
    await host.sendPrompt(agent, input); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const state = await snapshot();
    expect(state).toMatchObject({ busy: false, turns: [{ status: 'failed' }], error: expect.any(String) });
    expect(host.getRuntimeStatus()).toMatchObject({ status: 'error' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider.authenticationChanged', payload: expect.objectContaining({ kind: 'cursor', connected: false }) }));
    if (input.startsWith('team')) expect(state.error).toContain('Your team has switched');
    if (input.startsWith('policy')) expect(state.error).toMatch(/team policy/i);
    expect(JSON.stringify(events)).not.toContain('private.invalid');
  });
  it('rejects an unsupported version before any ACP process is started', async () => {
    await writeFile(path.join(root, 'version'), '2026.10.07-old');
    await expect(host.sendPrompt(agent, 'hello')).rejects.toThrow('2026.10.08');
    await expect(access(path.join(root, 'wire.jsonl'))).rejects.toThrow();
  });
  it('refuses an incompatible handshake before creating a conversation', async () => {
    await writeFile(path.join(root, 'no-list'), '');
    await expect(host.sendPrompt(agent, 'hello')).rejects.toThrow('safe cancellation');
    expect((await wire()).map(call => call.method)).toEqual(['initialize']);
  });
  it('rejects cross-session and workspace mutations without sending another prompt', async () => {
    const first = await host.sendPrompt(agent, 'hello'); await vi.waitFor(() => expect(completions()).toHaveLength(1));
    await expect(host.sendPrompt({ ...agent, backendSession: { kind: 'cursor', sessionId: 'wrong' } }, 'wrong')).rejects.toThrow('identity');
    await expect(host.sendPrompt({ ...agent, folder: path.join(root, 'different') }, 'wrong')).rejects.toThrow('workspace');
    expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1);
    expect(first.backendSession.kind).toBe('cursor');
  });
  it('queues a prompt behind the active turn and releases it only after cancellation settles', async () => {
    const first = await host.sendPrompt(agent, 'wait');
    let admitted = false;
    const queued = host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'again').then(result => { admitted = true; return result; });
    await vi.waitFor(async () => expect((await wire()).filter(call => call.method === 'session/prompt')).toHaveLength(1));
    expect(admitted).toBe(false);
    await host.interrupt(agent, first.turnId); await queued;
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect((await snapshot()).turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
  });
  it('bounds a non-cooperative cancellation and retains its interrupted transcript', async () => {
    const first = await host.sendPrompt(agent, 'ignore-cancel');
    await vi.waitFor(() => expect(JSON.stringify(events)).toContain('Hello'));
    vi.useFakeTimers();
    try {
      const stopped = host.interrupt(agent, first.turnId);
      await vi.advanceTimersByTimeAsync(5_000); await stopped;
      expect((await snapshot()).turns).toMatchObject([{ status: 'interrupted' }]);
      await expect(host.sendPrompt(agent, 'after-process-loss')).rejects.toThrow(/connection closed/i);
      vi.useRealTimers();
      if (first.backendSession.kind !== 'cursor') throw new Error('Invalid session');
      await host.resumeConversation!(agent, { ref: { backend: 'cursor', folder: root, sessionId: first.backendSession.sessionId }, storageState: 'active' });
      await host.sendPrompt({ ...agent, backendSession: first.backendSession }, 'RECOVERED');
      await vi.waitFor(() => expect(completions()).toHaveLength(2));
    } finally { vi.useRealTimers(); }
  });
  it('creates a private Quick Chat workspace and supplies no MCP servers', async () => {
    await host.sendPrompt({ ...agent, folder: null }, 'hello');
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    const created = (await wire()).find(call => call.method === 'session/new');
    expect(created.params.cwd).toContain('cursor-quick-chats');
    expect(created.params.cwd).not.toBe(process.cwd());
    expect(created.params.mcpServers).toEqual([]);
  });
  it('releases a session during startup without attaching a stale replica', async () => {
    await writeFile(path.join(root, 'hold-new'), '');
    const opening = host.sendPrompt(agent, 'hello').catch(error => error);
    await vi.waitFor(async () => expect((await wire()).some(call => call.method === 'session/new')).toBe(true));
    await host.releaseConversation!(agent.id);
    expect(await opening).toBeInstanceOf(Error);
    expect(events.some(event => event.type === 'cursor.conversationSnapshotChanged')).toBe(false);
  });
});
