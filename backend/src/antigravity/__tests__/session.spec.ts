import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpSession } from '../session';
import { AntigravityHost } from '../antigravity-host';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { CodeReviewService } from '../../review/code-review-service';
import { AgentCreationService } from '../../agents/agent-creation-service';
import { AppMcpService } from '../../mcp/service';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { sessionMcpServer } from '../mcp-bridge';
import { product } from '@workspace/core/product';


let root: string;
const sessions: AcpSession[] = [];
vi.mock('@workspace/core/runtime-discovery', async importOriginal => ({
  ...await importOriginal<typeof import('@workspace/core/runtime-discovery')>(),
  withDiscoveredRuntimePath: () => ({ ...process.env }),
}));
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-acp-session-'));
  vi.stubEnv('APP_ANTIGRAVITY_COMMAND', path.join(root, 'runtime'));
  vi.stubEnv('ANTIGRAVITY_HARNESS_PATH', path.join(root, 'harness'));
  vi.stubEnv('GEMINI_HOME', path.join(root, 'home'));
  vi.stubEnv('APP_HOME', path.join(root, 'app'));
  await writeFile(path.join(root, 'harness'), '', { mode: 0o700 });
  await writeFile(path.join(root, 'runtime'), `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\\n');
const fs=require('node:fs'), catalogFile=require('node:path').join(process.env.GEMINI_HOME,'catalog.json');
fs.mkdirSync(process.env.GEMINI_HOME,{recursive:true});
const catalog=()=>fs.existsSync(catalogFile)?fs.readFileSync(catalogFile,'utf8').trim().split('\\n').map(JSON.parse):[];
let sessionId=require('node:crypto').randomUUID(), promptId, mcpServers=[], planPhase, utility, permissionFixture, cancelPermissionFixture;
const update=update=>send({method:'session/update',params:{sessionId,update}});
async function review(text,reply) {
 const server=mcpServers.find(server=>server.name==='korus');
 if(!server) throw new Error('Missing korus server');
 const child=require('node:child_process').spawn(server.command,server.args,{env:{...process.env,...Object.fromEntries(server.env.map(item=>[item.name,item.value]))},stdio:['pipe','pipe','ignore']});
 const pending=new Map();let id=0;
 require('node:readline').createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);const done=pending.get(value.id);if(done)done(value);});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,value=>value.error?reject(new Error(value.error.message)):resolve(value.result));child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\\n');});
 const call=async(name,args)=>{const result=await rpc('tools/call',{name,arguments:args});if(result.isError)throw new Error(JSON.stringify(result));return result.structuredContent;};
 try {
  const tools=await rpc('tools/list',{});
  if(!tools.tools.some(tool=>tool.name==='report_finding')||tools.tools.some(tool=>tool.name==='create-agent')) throw new Error('Wrong review scope');
  const ledgerFile=require('node:path').join(process.cwd(),'fixture-ledger.json');
  if(text.split('</context>').at(-1).trim().startsWith('Fix the ')) {
   const finding=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
   fs.writeFileSync(require('node:path').join(process.cwd(),'fixture-code.txt'),'fixed');
   await call('update_finding',{findingId:finding.id,status:'fixed',evidence:'Fixture external tool wrote and verified fixed content.'});
  } else if(!fs.existsSync(require('node:path').join(process.cwd(),'fixture-code.txt'))) {
   const finding=await call('report_finding',{priority:'p2',title:'Fixture defect',body:'The fixture code needs a correction.'});
   fs.writeFileSync(ledgerFile,JSON.stringify(finding.finding??finding));
   await call('finish_review_round',{findingCount:1});
  } else await call('finish_review_round',{findingCount:0});
  update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Review turn complete.'}});reply({stopReason:'end_turn'});
 } finally {child.stdin.end();}
}
rl.on('line',line=>{
 const v=JSON.parse(line), reply=result=>send({id:v.id,result});
 if(v.method==='initialize') {fs.writeFileSync(require('node:path').join(process.cwd(),'fixture-initialize.json'),JSON.stringify(v.params));reply({protocolVersion:2,agentInfo:{name:'antigravity-acp',version:'1.3.0'}});}
 else if(v.method==='authenticate') reply({});
 else if(v.method==='session/new') {mcpServers=v.params.mcpServers;fs.writeFileSync(require('node:path').join(process.cwd(),'fixture-session.json'),JSON.stringify(v.params));fs.appendFileSync(catalogFile,JSON.stringify({sessionId,cwd:v.params.cwd,title:'Saved conversation'})+'\\n');reply({sessionId,models:{currentModelId:'gemini-low',availableModels:[{modelId:'gemini-low',name:'Gemini Low'},{modelId:'opaque-oss-id',name:'GPT-OSS 120B (Medium)'}]}});}
 else if(v.method==='session/list') reply({sessions:[...catalog(),{sessionId:'stored-session',cwd:process.cwd(),title:'Create a file'},{sessionId:'other-folder',cwd:'/another-workspace',title:'Private'}]});
 else if(v.method==='session/load') {
   sessionId=v.params.sessionId;
   mcpServers=v.params.mcpServers;
   const saved=require('node:path').join(process.env.GEMINI_HOME,sessionId+'.jsonl');
   if(fs.existsSync(saved)) {
     for(const line of fs.readFileSync(saved,'utf8').trim().split('\\n')) {const prompt=JSON.parse(line);update({sessionUpdate:'user_message_chunk',content:{type:'text',text:prompt.replace(/^\\/plan\\s*/,'')}});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Recovered.'}});}
     reply({});return;
   }
   update({sessionUpdate:'user_message_chunk',content:{type:'text',text:'Create a file'}});
   update({sessionUpdate:'tool_call',toolCallId:'replay-id',title:'Create file',kind:'edit',status:'completed'});
   update({sessionUpdate:'tool_call_update',toolCallId:'replay-id',status:'failed',rawOutput:'Rejected by user'});
   update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Denied.'}});
   reply({models:{currentModelId:'gemini-low',availableModels:[{modelId:'gemini-low',name:'Gemini Low'}]}});
 } else if(v.method==='session/prompt') {
   promptId=v.id;
   const text=v.params.prompt[0].text;
   if(text.startsWith('permission-fixture:')||text.startsWith('cancel-permission-fixture:')) {
     permissionFixture=JSON.parse(text.slice(text.indexOf(':')+1));
     if(text.startsWith('cancel-permission-fixture:')) {cancelPermissionFixture=true;fs.writeFileSync(require('node:path').join(process.cwd(),'cancel-permission-ready'),'');return;}
     update({sessionUpdate:'tool_call',...permissionFixture.toolCall,status:'pending'});
     send({id:v.id,method:'session/request_permission',params:{sessionId,...permissionFixture}});return;
   }
   if(text.endsWith('utility-fixture')) {utility=true;send({id:211,method:'fs/write_text_file',params:{sessionId,path:require('node:path').join(process.cwd(),'unwanted-write'),content:'bad'}});return;}
   fs.appendFileSync(require('node:path').join(process.env.GEMINI_HOME,sessionId+'.jsonl'),JSON.stringify(text)+'\\n');
   if(text.startsWith('/plan ')) {
     planPhase='question';
     send({id:v.id,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'interaction_plan',title:'Use the minimal plan?'},options:[{optionId:'minimal-plan',name:'Minimal',kind:'allow_once'}]}});return;
   }
   if(mcpServers.some(server=>server.env.some(item=>item.name==='KORUS_ACP_MCP_URL'&&item.value.includes('reviewContextId=')))) {void review(text,reply).catch(error=>{fs.writeFileSync(require('node:path').join(process.cwd(),'fixture-error.txt'),error.message);send({id:v.id,error:{code:-32603,message:error.message}});});return;}
   if(text==='crash') process.exit(1);
   if(text==='wait') return;
   if(text==='question'||text==='deny') {
     update({sessionUpdate:'tool_call',toolCallId:'live-id',title:'Create file',kind:'edit',status:'pending'});
     send({id:v.id,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:text==='question'?'interaction_1':'live-id',title:text==='question'?'Which option?':'Create file'},options:text==='question'?[{optionId:'native-choice-7',name:'Proceed',kind:'allow_once'}]:[{optionId:'native-deny-9',name:'Deny',kind:'reject_once'}]}});
   } else {update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Recovered.'}});reply({stopReason:'end_turn'});}
 } else if(v.method==='session/cancel') {
   if(cancelPermissionFixture) send({id:901,method:'session/request_permission',params:{sessionId,...permissionFixture}});
   else send({id:promptId,result:{stopReason:'cancelled'}});
 }
 else if(!v.method) {
   if(permissionFixture) {
     fs.writeFileSync(require('node:path').join(process.cwd(),'permission-response.json'),JSON.stringify(v));
     const selected=permissionFixture.options.find(option=>option.optionId===v.result?.outcome?.optionId);
     update({sessionUpdate:'tool_call_update',toolCallId:permissionFixture.toolCall.toolCallId,status:selected?.kind.startsWith('allow_')?'completed':'failed'});
     permissionFixture=undefined;send({id:promptId,result:{stopReason:cancelPermissionFixture?'cancelled':'end_turn'}});cancelPermissionFixture=false;return;
   }
   if(utility) {utility=false;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:v.error?'Tools denied; text result.':'Unexpected write'}});send({id:promptId,result:{stopReason:'end_turn'}});return;}
   if(planPhase==='question') {planPhase='write';send({id:900,method:'fs/write_text_file',params:{sessionId,path:require('node:path').join(process.cwd(),'PLAN.md'),content:'# Native plan\\n\\n1. Make the scoped change.\\n2. Verify it.'}});return;}
   if(planPhase==='write') {planPhase=undefined;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'The plan is ready.'}});send({id:promptId,result:{stopReason:'end_turn'}});return;}
   update({sessionUpdate:'tool_call_update',toolCallId:'live-id',status:v.result.outcome.optionId==='native-deny-9'?'failed':'completed',rawOutput:v.result.outcome.optionId});
   send({id:promptId,result:{stopReason:'end_turn'}});
 } else reply({});
});
`, { mode: 0o700 });
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.close()));
  vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
});
async function open(sessionId?: string, options: Partial<Parameters<typeof AcpSession.open>[0]> = {}) {
  const changed = vi.fn();
  const session = await AcpSession.open({ agentId: 'agent', cwd: root, home: path.join(root, 'home'), mcpServers: [], sessionId, changed, ...options });
  sessions.push(session);
  return { session, changed };
}

describe('Antigravity native session', () => {
  const mcpPermission = (tool: string) => ({
    toolCall: { toolCallId: 'native-mcp-call', title: `${product.mcpServerName}_${tool}`, kind: 'other', rawInput: { arguments: {} },
      _meta: { is_mcp_tool_call: true, mcp: { server: product.mcpServerName, tool } } },
    options: [
      { optionId: 'native-always-17', name: 'Allow Always', kind: 'allow_always' },
      { optionId: 'native-once-42', name: 'Allow', kind: 'allow_once' },
      { optionId: 'native-deny-9', name: 'Deny', kind: 'reject_once' },
    ],
  });

  it.each([
    { sessionId: undefined, mode: 'auto_edit', tool: 'set_status' },
    { sessionId: 'stored-session', mode: 'default', tool: 'finish_turn' },
    { sessionId: undefined, mode: 'default', tool: 'report_finding' },
  ])('pre-authorizes the supplied Korus server in $mode for $tool (session $sessionId)', async ({ sessionId, mode, tool }) => {
    const { session, changed } = await open(sessionId, { mcpServers: [sessionMcpServer('http://127.0.0.1:1/mcp?agentId=agent')] });
    await session.setMode(mode);
    await session.prompt(`permission-fixture:${JSON.stringify(mcpPermission(tool))}`).completion;
    const response = JSON.parse(await readFile(path.join(root, 'permission-response.json'), 'utf8'));
    expect(response.result).toStrictEqual({ outcome: { outcome: 'selected', optionId: 'native-once-42' } });
    expect(session.snapshot.clientRequests).toEqual([]);
    expect(changed.mock.calls.map(([event]) => event.type)).not.toContain('request.created');
    expect(session.snapshot.turns.at(-1)?.status).toBe('completed');
    expect(session.snapshot.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'tool', id: 'native-mcp-call', status: 'completed' }));
  });

  it.each([
    { boundary: 'Korus not supplied to the session', registered: false },
    { boundary: 'other MCP server', meta: { is_mcp_tool_call: true, mcp: { server: 'github', tool: 'set_status' } } },
    { boundary: 'title or arguments impersonating Korus', meta: undefined },
    { boundary: 'missing native MCP marker', meta: { mcp: { server: product.mcpServerName, tool: 'set_status' } } },
    { boundary: 'missing tool identity', meta: { is_mcp_tool_call: true, mcp: { server: product.mcpServerName } } },
    { boundary: 'command approval', kind: 'execute' },
    { boundary: 'file approval', kind: 'edit' },
    { boundary: 'native question', toolCallId: 'interaction_choice' },
    { boundary: 'no native allow-once choice', alwaysOnly: true },
  ])('keeps $boundary interactive', async scenario => {
    const { session, changed } = await open(undefined, { mcpServers: scenario.registered === false ? [] : [sessionMcpServer('http://127.0.0.1:1/mcp')] });
    const permission = mcpPermission('set_status');
    const toolCall = { ...permission.toolCall, ...('meta' in scenario ? { _meta: scenario.meta } : {}),
      ...(scenario.kind ? { kind: scenario.kind } : {}), ...(scenario.toolCallId ? { toolCallId: scenario.toolCallId } : {}) };
    const turn = session.prompt(`permission-fixture:${JSON.stringify({ ...permission, toolCall,
      ...(scenario.alwaysOnly ? { options: [permission.options[0]] } : {}) })}`);
    await vi.waitFor(() => expect(session.snapshot.clientRequests).toHaveLength(1));
    const request = session.snapshot.clientRequests[0]!;
    expect(request.kind).toBe(scenario.toolCallId ? 'ask_user' : 'confirm_tool');
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ type: 'request.created' }));
    session.respond({ id: request.id, outcome: scenario.alwaysOnly || scenario.toolCallId ? { kind: 'cancelled' } : { kind: 'decision', decision: 'deny' } });
    await turn.completion;
    const response = JSON.parse(await readFile(path.join(root, 'permission-response.json'), 'utf8'));
    expect(response.result).toStrictEqual({ outcome: scenario.alwaysOnly || scenario.toolCallId ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: 'native-deny-9' } });
  });

  it('rejects cross-session MCP approval requests and keeps tool-free generation disabled', async () => {
    const mcpServers = [sessionMcpServer('http://127.0.0.1:1/mcp')];
    const { session, changed } = await open(undefined, { mcpServers });
    await session.prompt(`permission-fixture:${JSON.stringify({ ...mcpPermission('finish_turn'), sessionId: 'other-session' })}`).completion;
    expect(JSON.parse(await readFile(path.join(root, 'permission-response.json'), 'utf8')).error).toStrictEqual({ code: -32603, message: 'Client request failed.' });
    expect(changed.mock.calls.map(([event]) => event.type)).not.toContain('request.created');
    const { session: utility } = await open(undefined, { mcpServers, tools: false });
    await utility.prompt(`permission-fixture:${JSON.stringify(mcpPermission('finish_turn'))}`).completion;
    expect(JSON.parse(await readFile(path.join(root, 'permission-response.json'), 'utf8')).result).toStrictEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('does not authorize a Korus MCP request arriving after cancellation', async () => {
    const { session, changed } = await open(undefined, { mcpServers: [sessionMcpServer('http://127.0.0.1:1/mcp')] });
    const turn = session.prompt(`cancel-permission-fixture:${JSON.stringify(mcpPermission('finish_turn'))}`);
    await vi.waitFor(async () => expect(await readFile(path.join(root, 'cancel-permission-ready'), 'utf8')).toBe(''));
    await session.interrupt(turn.turnId);
    expect(JSON.parse(await readFile(path.join(root, 'permission-response.json'), 'utf8')).result).toStrictEqual({ outcome: { outcome: 'cancelled' } });
    expect(changed.mock.calls.map(([event]) => event.type)).not.toContain('request.created');
    expect(session.snapshot.turns.at(-1)?.status).toBe('interrupted');
  });

  it('generates auxiliary text with no MCP or filesystem tools and preserves the agent conversation', async () => {
    const host = new AntigravityHost();
    const agent: Agent = { id: 'utility', name: 'Utility', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    const events: BackendEvent[] = [];
    host.onEvent(event => events.push(event));
    try {
      const result = await host.generateText(agent, { cwd: root, prompt: 'utility-fixture', outputSchema: { type: 'string' } });
      expect(result.text).toBe('Tools denied; text result.');
      expect(JSON.parse(await readFile(path.join(root, 'fixture-initialize.json'), 'utf8')).clientCapabilities.fs).toEqual({ readTextFile: false, writeTextFile: false });
      expect(JSON.parse(await readFile(path.join(root, 'fixture-session.json'), 'utf8'))).toMatchObject({ mcpServers: [], _meta: { agy: { enabledTools: [] } } });
      await expect(readFile(path.join(root, 'unwanted-write'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(events).toEqual([]);
      expect(agent.backendSession).toBeUndefined();
    } finally { await host.close(); }
  });
  it('keeps utility generation sessions out of history and stores no prompt text for them', async () => {
    const host = new AntigravityHost();
    const agent: Agent = { id: 'utility', name: 'Utility', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    try {
      await host.generateText(agent, { cwd: root, prompt: 'utility-fixture-diff' });
      const generated = (await readFile(path.join(root, 'home', 'catalog.json'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).sessionId as string);
      expect(generated).toHaveLength(1);
      const sessionDirectory = path.join(root, 'home', 'korus-sessions', encodeURIComponent(generated[0]!));
      await expect(readFile(path.join(sessionDirectory, 'prompts.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      const rows = await host.listConversations(agent);
      expect(rows.map(row => row.id)).toEqual(['stored-session']);
    } finally { await host.close(); }
  });

  it('adapts a native plan artifact and question into the existing app confirmation before implementation', async () => {
    const snapshot = createEmptySnapshot();
    const agent: Agent = { id: 'planner', name: 'Planner', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    snapshot.agents = [agent];
    snapshot.providerConnections = [{ backend: 'antigravity', installed: true, connected: true, checking: false }];
    const host = new AntigravityHost();
    const events: BackendEvent[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map([['antigravity', host]])), onEvent: event => events.push(event) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'plan', method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'Describe the change', options: { planMode: true } } });
      await vi.waitFor(() => expect(events.some(event => event.type === 'agentRequest.created')).toBe(true));
      const pending = events.find(event => event.type === 'agentRequest.created')!;
      if (pending.type !== 'agentRequest.created') throw new Error('Missing native question');
      await host.respondToAgentRequest({ id: pending.payload.request.id, agentId: agent.id, outcome: { kind: 'answered', answers: { interaction_plan: { answers: ['Minimal'] } } } });
      await vi.waitFor(() => expect(agent.planReview).toMatchObject({ status: 'pending', markdown: '# Native plan\n\n1. Make the scoped change.\n2. Verify it.' }));
      expect(await readFile(path.join(root, 'PLAN.md'), 'utf8')).toBe(agent.planReview!.markdown);
      expect(agent.status.type).toBe('idle');
      await server.handleMessage({ jsonrpc: '2.0', id: 'accept', method: 'agent/planReview/respond', params: { agentId: agent.id, response: { reviewId: agent.planReview!.id, resolution: 'accept' } } });
      await vi.waitFor(() => expect(agent.planReview?.status).toBe('accept'));
      await vi.waitFor(() => expect(events.filter(event => event.type === 'antigravity.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toHaveLength(2));
      const history = await host.readConversationMessages({ backend: 'antigravity', sessionId: agent.backendSession!.kind === 'antigravity' ? agent.backendSession!.sessionId : '', folder: root }, agent.id);
      expect(history.filter(message => message.role === 'user').at(-1)?.parts).toEqual([{ type: 'text', text: 'implement the plan' }]);
    } finally { await server.close(); }
  });
  it('runs the real review ledger through the scoped stdio bridge, fixes a finding, and completes a clean second round', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.general.providerEnabled = { antigravity: true };
    snapshot.providerConnections = [{ backend: 'antigravity', installed: true, connected: true, checking: false }];
    const owner: Agent = { id: 'owner', name: 'Owner', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    snapshot.agents.push(owner);
    const mcp = new AppMcpService({ snapshot });
    const url = await mcp.start();
    const host = new AntigravityHost({ appMcpServerUrl: url });
    const creation = new AgentCreationService(snapshot);
    const dispose = vi.fn(async (agent: Agent) => {
      if (agent.backendSession) await host.disposeCodeReview(agent, agent.backendSession);
      snapshot.agents = snapshot.agents.filter(candidate => candidate.id !== agent.id);
    });
    const checkpoint = { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'fixture' };
    const commit = vi.fn();
    const review = new CodeReviewService({ snapshot, tools: mcp,
      createAgent: (input, options) => creation.create(input, options),
      runReview: (agent, prompt, reviewMcpServerUrl, reviewerSession) => host.runCodeReview(agent, { prompt, cwd: root, reviewMcpServerUrl, reviewerSession }),
      resetReviewer: async agent => { await host.releaseConversation(agent.id); delete agent.backendSession; },
      deleteReviewer: dispose, saveReport: async () => path.join(root, 'report.md'), changed: () => {},
      git: { prepare: async () => ({ ...checkpoint, baseRef: 'a'.repeat(40) }), inspect: async () => checkpoint, hasChanges: async () => false, commit },
    });
    try {
      const result = review.startAutomatic(owner, { scope: { type: 'uncommitted' }, maxRounds: 3, autoCommit: false });
      await vi.waitFor(async () => expect(result.automation?.state, await readFile(path.join(root, 'fixture-error.txt'), 'utf8').catch(() => JSON.stringify(result.rounds))).toBe('completed'), { timeout: 3000 });
      expect(result.rounds.map(round => round.inspectionCompletion?.findingCount)).toEqual([1, 0]);
      expect(result.rounds[0]?.findings[0]?.remediation).toMatchObject({ state: 'fixed', evidence: expect.stringContaining('verified') });
      expect(await readFile(path.join(root, 'fixture-code.txt'), 'utf8')).toBe('fixed');
      expect(dispose).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(snapshot.agents).toEqual([owner]));
      expect(commit).not.toHaveBeenCalled();
    } finally { await host.close(); await mcp.stop(); }
  });
  it('routes two same-folder agents through distinct native sessions and validated provider frames', async () => {
    const host = new AntigravityHost();
    const events: BackendEvent[] = [];
    host.onEvent(event => { decodeAppBackendEvent({ ...event, seq: events.length + 1, occurredAt: new Date().toISOString() }); events.push(event); });
    const first: Agent = { id: 'first', name: 'First', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    const second = { ...first, id: 'second' };
    try {
      const [a, b] = await Promise.all([host.sendPrompt(first, 'hello'), host.sendPrompt(second, 'hello')]);
      expect(a.backendSession).not.toEqual(b.backendSession);
      expect(a.backendSession.kind).toBe('antigravity');
      await vi.waitFor(() => expect(events.filter(event => event.type === 'antigravity.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toHaveLength(2));
      expect(await host.listModels(first)).toEqual([
        { id: 'gemini-low', model: 'gemini-low', displayName: 'Gemini Low', isDefault: true },
        { id: 'opaque-oss-id', model: 'opaque-oss-id', displayName: 'GPT-OSS 120B (Medium)', isDefault: false },
      ]);
      const snapshots = events.filter(event => event.type === 'antigravity.conversationSnapshotChanged');
      expect(snapshots.map(event => event.agentId)).toEqual(expect.arrayContaining(['first', 'second']));
      first.backendSession = a.backendSession;
      await host.releaseConversation(first.id);
      await host.loadConversation(first);
      const loaded = events.filter(event => event.type === 'antigravity.conversationSnapshotChanged').at(-1)!;
      expect(loaded.payload.snapshot.messages).toHaveLength(2);
      expect(loaded.payload.snapshot.messages[0]?.parts).toEqual([{ type: 'text', text: 'hello' }]);
      expect(loaded.payload.snapshot.messages[1]?.parts).toEqual([{ type: 'text', text: 'Recovered.' }]);
    } finally { await host.close(); }
  });
  it('serializes prompts, cancels natively, and accepts a fresh turn in the same process', async () => {
    const { session } = await open();
    const first = session.prompt('wait');
    expect(() => session.prompt('overlap')).toThrow('previous turn');
    await expect(session.interrupt('stale-turn')).rejects.toThrow('changed');
    await session.interrupt(first.turnId);
    expect(session.snapshot.turns[0]?.status).toBe('interrupted');
    await session.prompt('next').completion;
    expect(session.snapshot.turns.map(turn => turn.status)).toEqual(['interrupted', 'completed']);
    expect(session.snapshot.messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'Recovered.' }]);
  });

  it('preserves user text and attachment chips across cold replay without exposing injected instructions', async () => {
    const file = path.join(root, 'notes.txt');
    await writeFile(file, 'Synthetic context');
    const host = new AntigravityHost();
    const agent: Agent = { id: 'attachments', name: 'Attachments', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    const events: BackendEvent[] = [];
    host.onEvent(event => events.push(event));
    try {
      const result = await host.sendPrompt(agent, 'Read my notes', { attachments: [{ type: 'file', path: file, name: 'notes.txt', mimeType: 'text/plain' }] });
      agent.backendSession = result.backendSession;
      await vi.waitFor(() => expect(events.some(event => event.type === 'antigravity.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toBe(true));
      const ref = { backend: 'antigravity' as const, sessionId: result.backendSession.kind === 'antigravity' ? result.backendSession.sessionId : '', folder: root };
      const live = await host.readConversationMessages(ref, agent.id);
      await host.releaseConversation(agent.id);
      const replay = await host.readConversationMessages(ref, agent.id);
      expect(replay.map(message => message.parts)).toEqual(live.map(message => message.parts));
      expect(replay[0]?.parts).toEqual([{ type: 'text', text: 'Read my notes' }, { type: 'attachment', attachment: { kind: 'file', name: 'notes.txt', path: file, mimeType: 'text/plain' } }]);
    } finally { await host.close(); }
  });

  it('opens a conversation whose prompt journal ends in a torn line, keeping the intact entries', async () => {
    const host = new AntigravityHost();
    const agent: Agent = { id: 'torn', name: 'Torn', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    const events: BackendEvent[] = [];
    host.onEvent(event => events.push(event));
    try {
      const result = await host.sendPrompt(agent, 'Keep this prompt');
      agent.backendSession = result.backendSession;
      await vi.waitFor(() => expect(events.some(event => event.type === 'antigravity.conversationEventReceived' && event.payload.event.type === 'turn.completed')).toBe(true));
      const sessionId = result.backendSession.kind === 'antigravity' ? result.backendSession.sessionId : '';
      await host.releaseConversation(agent.id);
      await appendFile(path.join(root, 'home', 'korus-sessions', encodeURIComponent(sessionId), 'prompts.jsonl'), '{"wireText":"half');
      const replay = await host.readConversationMessages({ backend: 'antigravity', sessionId, folder: root }, agent.id);
      expect(replay[0]?.parts).toEqual([{ type: 'text', text: 'Keep this prompt' }]);
    } finally { await host.close(); }
  });

  it.each(['deny', 'question'] as const)('maps %s to the exact native option and resolves its app request', async kind => {
    const { session, changed } = await open();
    const turn = session.prompt(kind);
    await vi.waitFor(() => expect(session.snapshot.clientRequests).toHaveLength(1));
    const request = session.snapshot.clientRequests[0]!;
    expect(request.kind).toBe(kind === 'question' ? 'ask_user' : 'confirm_tool');
    expect(() => session.respond({ id: request.id, agentId: 'other', outcome: { kind: 'cancelled' } })).toThrow('another agent');
    expect(() => session.respond({ id: request.id, outcome: { kind: 'decision', decision: 'always_allow' } })).toThrow('options supplied');
    session.respond({ id: request.id, outcome: kind === 'question' ? { kind: 'answered', answers: { interaction_1: { answers: ['Proceed'] } } } : { kind: 'decision', decision: 'deny' } });
    await turn.completion;
    expect(session.snapshot.clientRequests).toEqual([]);
    expect(session.snapshot.answeredClientRequestIds).toContain(request.id);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ type: 'request.resolved', payload: {
      id: request.id, outcome: kind === 'question' ? { kind: 'answered', answers: { interaction_1: { answers: ['Proceed'] } } } : { kind: 'decision', decision: 'deny' },
    } }));
    expect(session.snapshot.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'tool', status: kind === 'question' ? 'completed' : 'failed', output: kind === 'question' ? 'native-choice-7' : 'native-deny-9' }));
  });

  it('rebuilds loaded history from changed replay IDs in order without publishing partial history', async () => {
    const { session, changed } = await open('stored-session');
    expect(session.sessionId).toBe('stored-session');
    expect(changed).not.toHaveBeenCalled();
    expect(session.snapshot.messages).toHaveLength(2);
    expect(session.snapshot.messages.map(message => message.createdAt)).toEqual(['', '']);
    expect(session.snapshot.turns[0]).toMatchObject({ startedAt: '', completedAt: '', durationMs: null });
    expect(session.snapshot.messages[1]?.parts).toEqual([
      expect.objectContaining({ type: 'tool', id: 'replay-id', status: 'failed', output: 'Rejected by user' }),
      { type: 'text', text: 'Denied.' },
    ]);
    expect(session.snapshot).toMatchObject({ busy: false, activeTurnId: null, clientRequests: [] });
  });

  it('validates folder-scoped history and coordinates model reads with completed or cancelled resume', async () => {
    const host = new AntigravityHost();
    const agent: Agent = { id: 'history', name: 'History', folder: root, backend: 'antigravity', createdAt: '', updatedAt: '', status: { type: 'idle' } };
    try {
      const rows = await host.listConversations(agent, { searchTerm: 'file' });
      expect(rows).toEqual([expect.objectContaining({ id: 'stored-session', title: 'Create a file', updatedAt: '', ref: { backend: 'antigravity', sessionId: 'stored-session', folder: root } })]);
      await expect(host.resumeConversation(agent, { storageState: 'active', ref: { backend: 'antigravity', folder: root, sessionId: 'other-folder' } })).rejects.toThrow('another workspace');
      const messages = await host.readConversationMessages(rows[0]!.ref, agent.id);
      expect(messages).toHaveLength(2);
      expect(messages[1]?.parts[0]).toMatchObject({ type: 'tool', status: 'failed' });
      expect(await host.readConversationSummary(agent, rows[0]!.ref)).toEqual(rows[0]);
      const loading = host.resumeConversation(agent, { storageState: 'active', ref: rows[0]!.ref });
      const catalog = expect(host.listModels(agent)).resolves.toEqual([
        { id: 'gemini-low', model: 'gemini-low', displayName: 'Gemini Low', isDefault: true },
      ]);
      await expect(host.sendPrompt(agent, 'too early')).rejects.toThrow('history is still loading');
      await loading;
      await catalog;
      await expect(host.readConversationMessages({ backend: 'antigravity', sessionId: rows[0]!.sessionId!, folder: path.join(root, 'home') }, agent.id)).rejects.toThrow('another workspace');
      const cancelledLoad = expect(host.resumeConversation(agent, { storageState: 'active', ref: rows[0]!.ref })).rejects.toThrow('released during history loading');
      const cancelledCatalog = expect(host.listModels(agent)).rejects.toThrow('released during model loading');
      await host.releaseConversation(agent.id);
      await Promise.all([cancelledLoad, cancelledCatalog]);
    } finally { await host.close(); }
  });

  it('marks runtime exit as a failed turn and rejects future work on the dead session', async () => {
    const { session } = await open();
    await session.prompt('crash').completion;
    expect(session.snapshot).toMatchObject({ busy: false, turns: [expect.objectContaining({ status: 'failed' })], error: expect.stringContaining('Antigravity') });
    expect(() => session.prompt('next')).toThrow('closed');
  });
});
