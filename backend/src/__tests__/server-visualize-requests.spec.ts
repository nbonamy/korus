import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { BackendDriverRpc } from '../driver-rpc';
import { AppBackendServer } from '../server';
import { createTestSnapshot } from './server-test-fixtures';

describe('AppBackendServer Visualize workflow', () => {
  it('routes canvas saves through the owning agent and publishes persisted content', async () => {
    const { agentId, server, snapshot } = setup();
    try {
      await request(server, { agentId });
      const session = snapshot.agents.at(-1)!.visualize!;
      session.visualizations.push({ id: 'canvas', title: 'Canvas', content: { kind: 'svg', source: '<svg />' }, createdAt: '', updatedAt: '' });
      const result = await server.handleMessage({ jsonrpc: '2.0', id: 'canvas-save', method: backendMethods.agentVisualizationCanvasSave, params: {
        agentId, input: { sessionId: session.id, expectedSource: JSON.stringify(session.visualizations[0].content), visualizationId: 'canvas', expectedRevision: 0, document: { elements: [], files: {}, selectedElementIds: [], preview: '' } },
      } });
      expect(result).toMatchObject({ result: { revision: 1, elements: [] } });
      expect(snapshot.agents.at(-1)!.visualize!.visualizations[0].canvas?.revision).toBe(1);
    } finally { await server.close(); }
  });

  it('requests one synchronous visualization choice on first entry and only opens the pane on reentry', async () => {
    const { agentId, sendPrompt, server, snapshot } = setup();

    await request(server, { agentId });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
    const startPrompt = sendPrompt.mock.calls[0][1];
    expect(startPrompt).toMatch(/one synchronous, single-select question with exactly three/u);
    expect(startPrompt).toContain('existing Other');
    expect(startPrompt).toMatch(/Do not browse,[\s\S]*background research/u);
    expect(startPrompt).toMatch(/<context>[\s\S]*<\/context>$/u);
    expect(snapshot.agents.at(-1)?.visualize).toMatchObject({
      suggestions: [], visualizations: [], selectedVisualizationId: null,
    });

    await request(server, { agentId });
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it('starts /visualize with a direction by creating a visualization directly', async () => {
    const { agentId, sendPrompt, server, snapshot } = setup();

    await request(server, { agentId, input: { prompt: 'the architecture of the feature' } });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
    const startPrompt = sendPrompt.mock.calls[0][1];
    expect(startPrompt.slice(0, startPrompt.indexOf('<context>')).trim()).toBe('Visualize the architecture of the feature.');
    expect(startPrompt).toContain('Create one visualization for this request');
    expect(startPrompt).toContain('Do not suggest visualizations first');
    expect(startPrompt).toContain('workspace.add-visualization without a suggestion ID');
    expect(snapshot.agents.at(-1)?.visualize?.suggestions).toStrictEqual([]);
    await server.close();
  });

  it.each([false, true])('requests a fresh choice with an existing library (pane open: %s) without changing its canvas', async isOpen => {
    const { agentId, sendPrompt, server, snapshot } = setup();
    const visualization = {
      id: 'existing-map', title: 'User-edited map', content: { kind: 'mermaid' as const, source: 'flowchart LR; A --> B' },
      canvas: { revision: 2, elements: [], files: {}, selectedElementIds: [], preview: '' },
      createdAt: '', updatedAt: '',
    };
    snapshot.agents.at(-1)!.visualize = {
      id: 'visualize-library', conversationRef: null, isOpen, suggestions: [],
      visualizations: [structuredClone(visualization)], selectedVisualizationId: visualization.id,
      createdAt: '', updatedAt: '',
    };
    try {
      await request(server, { agentId, input: { choose: true } });
      await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));
      expect(sendPrompt.mock.calls[0][1]).toMatch(/one synchronous, single-select question with exactly three/u);
      expect(snapshot.agents.at(-1)?.visualize).toMatchObject({
        isOpen: true, visualizations: [visualization], selectedVisualizationId: visualization.id,
      });
      await request(server, { agentId });
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    } finally { await server.close(); }
  });

  it('requests a choice when reopening a closed empty pane and clears stale cards', async () => {
    const { agentId, sendPrompt, server, snapshot } = setup();
    snapshot.agents.at(-1)!.visualize = {
      id: 'visualize-closed',
      conversationRef: null,
      isOpen: false,
      suggestions: [{ id: 'stale-suggestion', title: 'Old', description: 'An old suggestion.' }],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };

    await request(server, { agentId });
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1));

    expect(sendPrompt.mock.calls[0][1]).toMatch(/one synchronous, single-select question with exactly three/u);
    expect(snapshot.agents.at(-1)?.visualize).toMatchObject({ isOpen: true, suggestions: [] });
    await server.close();
  });
});

function setup(): {
  agentId: string;
  sendPrompt: ReturnType<typeof vi.fn>;
  server: AppBackendServer;
  snapshot: ReturnType<typeof createTestSnapshot>;
} {
  const snapshot = createTestSnapshot();
  const agent = {
    id: 'agent-visualize', teamId: 'team-test', name: 'Dina', folder: '/repo', backend: 'codex' as const,
    status: { type: 'idle' as const }, createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z',
  };
  snapshot.agents.push(agent);
  snapshot.teams[0].agentIds.push(agent.id);
  const sendPrompt = vi.fn().mockResolvedValue({
    backendSession: { kind: 'codex' as const, threadId: 'thread-visualize' },
    turnId: 'turn-visualize',
  });
  const driver: AgentBackendDriver = {
    backend: 'codex',
    getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => codexBackendCapabilities,
    sendPrompt,
    interrupt: vi.fn(),
    respondToAgentRequest: vi.fn(),
    onEvent: () => () => undefined,
    close: vi.fn(),
  };
  const server = new AppBackendServer({
    version: 'test',
    snapshot,
    driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
  });
  return { agentId: agent.id, sendPrompt, server, snapshot };
}

async function request(server: AppBackendServer, params: unknown): Promise<void> {
  const response = await server.handleMessage({
    jsonrpc: '2.0', id: 'visualize', method: backendMethods.agentVisualizeStart, params,
  });
  expect(response).toHaveProperty('result');
}
