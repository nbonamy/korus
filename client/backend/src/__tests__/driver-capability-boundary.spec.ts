import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import type { Agent } from '@workspace/core/contracts';
import { claudeProviderCapabilities } from '@workspace/core/provider-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ProviderDriverRpc, createProviderDriver } from '../driver-rpc';
import { scriptedDriver } from './support/scripted-driver';

const agent: Agent = { id: 'limited', name: 'Limited', folder: '/repo', provider: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };

function fixture() {
  const driver: AgentProviderDriver = {
    provider: 'claude', getRuntimeStatus: () => ({ provider: 'claude', status: 'running' }),
    getCapabilities: () => claudeProviderCapabilities,
    sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(),
    onEvent: () => () => undefined, close: async () => undefined,
  };
  return { driver, rpc: new ProviderDriverRpc(new Map([['claude', driver]])) };
}

describe('unified driver capability boundary', () => {
  it('selects the Antigravity host explicitly and never creates Codex as a fallback', async () => {
    const driver = createProviderDriver('antigravity');
    try {
      expect(driver.provider).toBe('antigravity');
      expect(driver.getCapabilities({ ...agent, provider: 'antigravity' })).toMatchObject({ goals: false, conversationFork: false });
    } finally { await driver.close(); }
  });
  it.each([
    [backendMethods.driverTextGenerate, { prompt: 'draft', cwd: '/repo' }],
    [backendMethods.driverConversationReplaceWithSummary, {}],
    [backendMethods.driverConversationTitleUpdate, { title: 'title' }],
    [backendMethods.driverGoalUpdate, { objective: 'ship' }],
    [backendMethods.driverGoalClear, {}],
    [backendMethods.driverPermissionModeUpdate, { mode: 'default' }],
    [backendMethods.driverConversationLoad, {}],
    [backendMethods.driverConversationHistoryLoadOlder, {}],
    [backendMethods.driverConversationsList, {}],
    [backendMethods.driverConversationResume, { target: { ref: { provider: 'claude', sessionId: 'session' } } }],
    [backendMethods.driverConversationFork, { targetAgent: { ...agent, id: 'fork' } }],
    [backendMethods.driverConversationSummaryGet, { ref: { provider: 'claude', sessionId: 'session' } }],
    [backendMethods.driverPromptSteer, { prompt: 'change course' }],
    [backendMethods.driverTurnDelete, { turnId: 'turn' }],
    [backendMethods.driverTurnEdit, { turnId: 'turn', content: 'replacement' }],
    [backendMethods.driverTurnRetry, { turnId: 'turn' }],
    [backendMethods.driverPluginsList, {}],
  ])('rejects unavailable %s instead of inventing success or sending a prompt', async (method, params) => {
    const { driver, rpc } = fixture();
    await expect(rpc.handle(method, { agent, ...params })).rejects.toThrow(/not support/i);
    expect(driver.sendPrompt).not.toHaveBeenCalled();
    expect(driver.interrupt).not.toHaveBeenCalled();
  });

  it('validates and forwards image-only utility attachments before provider execution', async () => {
    const {driver,rpc}=fixture();
    driver.generateText=vi.fn().mockResolvedValue({text:'ok'});
    const image=path.resolve(import.meta.dirname,'../../../electron/assets/viz/reference.png');
    const request={agent,cwd:'/repo',prompt:'Inspect',timeoutMs:null,mcpServers:[{name:'diagram_icons_job',url:'http://127.0.0.1:1234/mcp/token',enabledTools:['fetch_tech_icon']}],attachments:[{type:'image',path:image,mimeType:'image/png'}]};
    await expect(rpc.handle(backendMethods.driverTextGenerate,request)).resolves.toEqual({text:'ok'});
    expect(driver.generateText).toHaveBeenCalledWith(agent,expect.objectContaining({timeoutMs:null,attachments:request.attachments,mcpServers:request.mcpServers}));
    for(const attachments of [[{type:'file',path:image}],[{type:'image',path:'relative.png'}],[{type:'image',path:image,mimeType:'image/jpeg'}],Array(5).fill({type:'image',path:image})]) {
      await expect(rpc.handle(backendMethods.driverTextGenerate,{...request,attachments})).rejects.toThrow(/image|attachment/i);
    }
    for (const mcpServers of [ [{...request.mcpServers[0],url:'https://example.com/mcp/token'}], [{...request.mcpServers[0],enabledTools:['send-message']}], [{...request.mcpServers[0],name:'global'}], [...request.mcpServers,...request.mcpServers] ]) {
      await expect(rpc.handle(backendMethods.driverTextGenerate,{...request,mcpServers})).rejects.toThrow(/MCP/i);
    }
    expect(driver.generateText).toHaveBeenCalledTimes(1);
  });

  it('distinguishes legitimately empty catalogs and unsupported archival from failed commands', async () => {
    const { rpc } = fixture();
    await expect(rpc.handle(backendMethods.driverModelsList, { agent })).resolves.toStrictEqual([]);
    await expect(rpc.handle(backendMethods.driverSkillsList, { agent })).resolves.toStrictEqual([]);
    await expect(rpc.handle(backendMethods.driverConversationArchive, { agent })).resolves.toStrictEqual({ supported: false });
  });

  it('reports what a harness cannot do from its capabilities, so closing an agent never fails on a missing archive', async () => {
    // The real driver has every operation; whether the harness offers one is a capability, not a missing method.
    const claude = scriptedDriver('claude').driver; const cursor = scriptedDriver('cursor').driver;
    const rpc = new ProviderDriverRpc(new Map([['claude', claude], ['cursor', cursor]]));
    try {
      const closing = { ...agent, providerSession: { kind: 'claude' as const, sessionId: 's', transport: 'stdio' as const } };
      await expect(rpc.handle(backendMethods.driverConversationArchive, { agent: closing })).resolves.toStrictEqual({ supported: false });
      const onCursor = { ...agent, provider: 'cursor' as const };
      await expect(rpc.handle(backendMethods.driverConversationDelete, { agent: onCursor })).resolves.toStrictEqual({ supported: false });
      await expect(rpc.handle(backendMethods.driverSkillsList, { agent: onCursor })).resolves.toStrictEqual([]);
    } finally { await rpc.close(); }
  });

  it('rejects an unadvertised permission mode even when the operation exists', async () => {
    const { driver, rpc } = fixture();
    driver.setPermissionMode = vi.fn();
    await expect(rpc.handle(backendMethods.driverPermissionModeUpdate, { agent, mode: 'invented-mode' })).rejects.toThrow('Unsupported permission mode');
    expect(driver.setPermissionMode).not.toHaveBeenCalled();
  });
});
