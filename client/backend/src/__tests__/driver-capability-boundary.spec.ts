import { describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import type { Agent } from '@workspace/core/contracts';
import { claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { BackendDriverRpc, createBackendDriver } from '../driver-rpc';

const agent: Agent = { id: 'limited', name: 'Limited', folder: '/repo', backend: 'claude', status: { type: 'idle' }, createdAt: '', updatedAt: '' };

function fixture() {
  const driver: AgentBackendDriver = {
    backend: 'claude', getRuntimeStatus: () => ({ backend: 'claude', status: 'running' }),
    getCapabilities: () => claudeBackendCapabilities,
    sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(),
    onEvent: () => () => undefined, close: async () => undefined,
  };
  return { driver, rpc: new BackendDriverRpc(new Map([['claude', driver]])) };
}

describe('unified driver capability boundary', () => {
  it('selects the Antigravity host explicitly and never creates Codex as a fallback', async () => {
    const driver = createBackendDriver('antigravity');
    try {
      expect(driver.backend).toBe('antigravity');
      expect(driver.getCapabilities({ ...agent, backend: 'antigravity' })).toMatchObject({ goals: false, conversationFork: false });
    } finally { await driver.close(); }
  });
  it.each([
    [backendMethods.driverTextGenerate, { prompt: 'draft', cwd: '/repo' }],
    [backendMethods.driverConversationReplaceWithSummary, {}],
    [backendMethods.driverConversationTitleUpdate, { title: 'title' }],
    [backendMethods.driverGoalUpdate, { objective: 'ship' }],
    [backendMethods.driverGoalClear, {}],
    [backendMethods.driverApprovalPresetUpdate, { preset: 'full-access' }],
    [backendMethods.driverPermissionModeUpdate, { mode: 'default' }],
    [backendMethods.driverConversationLoad, {}],
    [backendMethods.driverConversationHistoryLoadOlder, {}],
    [backendMethods.driverConversationsList, {}],
    [backendMethods.driverConversationResume, { target: { ref: { backend: 'claude', sessionId: 'session' } } }],
    [backendMethods.driverConversationFork, { targetAgent: { ...agent, id: 'fork' } }],
    [backendMethods.driverConversationSummaryGet, { ref: { backend: 'claude', sessionId: 'session' } }],
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

  it('distinguishes legitimately empty catalogs and unsupported archival from failed commands', async () => {
    const { rpc } = fixture();
    await expect(rpc.handle(backendMethods.driverModelsList, { agent })).resolves.toStrictEqual([]);
    await expect(rpc.handle(backendMethods.driverSkillsList, { agent })).resolves.toStrictEqual([]);
    await expect(rpc.handle(backendMethods.driverConversationArchive, { agent })).resolves.toStrictEqual({ supported: false });
  });

  it('rejects an unadvertised permission mode even when the operation exists', async () => {
    const { driver, rpc } = fixture();
    driver.setPermissionMode = vi.fn();
    await expect(rpc.handle(backendMethods.driverPermissionModeUpdate, { agent, mode: 'invented-mode' })).rejects.toThrow('Unsupported permission mode');
    expect(driver.setPermissionMode).not.toHaveBeenCalled();
  });
});
