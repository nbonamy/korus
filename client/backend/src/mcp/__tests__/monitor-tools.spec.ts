import { afterEach, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { parseCollaborationMessageEnvelope } from '@workspace/core/collaboration-message-envelope';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppMcpService } from '../service';
const services: AppMcpService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
});
it('exposes monitors only to local backends without native support, scopes ownership and validates inputs', async () => {
  const snapshot = createInitialSnapshot();
  snapshot.agents[0]!.folder = process.cwd();
  const service = new AppMcpService({ snapshot });
  services.push(service);
  const url = await service.start();
  const request = async (agentId: string, method: string, params: unknown) => {
    const response = await fetch(`${url}?agentId=${agentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (
      (await response.json()) as {
        result: CallToolResult & {
          tools: { name: string }[];
          structuredContent: { monitors: { id: string; state: string }[] };
        };
      }
    ).result;
  };
  const owner = snapshot.agents[0]!;
  const call = (args: unknown, id = owner.id) =>
    request(id, 'tools/call', { name: 'korus-monitor', arguments: args });
  expect(
    (await request(owner.id, 'tools/list', {})).tools.some(
      (tool: { name: string }) => tool.name === 'korus-monitor',
    ),
  ).toBe(true);
  expect(
    (
      await call({
        action: 'start',
        name: 'test',
        command: 'echo done',
        delivery: 'onCompletion',
        timeoutSeconds: 10,
      })
    ).isError,
  ).not.toBe(true);
  const list = await call({ action: 'list' });
  expect(list.structuredContent.monitors).toHaveLength(1);
  const id = list.structuredContent.monitors[0].id;
  expect(
    (await call({ action: 'stop', id }, snapshot.agents[1]!.id)).isError,
  ).toBe(true);
  expect(
    (
      await call({
        action: 'start',
        name: 'invalid',
        command: '',
        delivery: 'onCompletion',
      })
    ).isError,
  ).toBe(true);
  service.stopAgentMonitors(owner.id);
  expect(
    (await call({ action: 'list' })).structuredContent.monitors[0].state,
  ).not.toBe('running');
  owner.backend = 'claude';
  expect(
    (await request(owner.id, 'tools/list', {})).tools.some(
      (tool: { name: string }) => tool.name === 'korus-monitor',
    ),
  ).toBe(false);
});

it('retains completion events while busy, delivers to the owning idle agent, and discards events on Stop', async () => {
  const { vi } = await import('vitest');
  const { BackendDriverRpc } = await import('../../driver-rpc');
  const { codexBackendCapabilities } =
    await import('@workspace/core/backend-capabilities');
  const snapshot = createInitialSnapshot();
  const owner = snapshot.agents[0]!;
  owner.folder = process.cwd();
  owner.status = { type: 'working' };
  const sendPrompt = vi
    .fn()
    .mockResolvedValue({
      backendSession: { kind: 'codex', threadId: 'monitor-thread' },
      turnId: 'monitor-turn',
    });
  const driver: import('@workspace/core/backend-driver').AgentBackendDriver = {
    backend: 'codex',
    getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => ({
      ...codexBackendCapabilities,
      steerPrompt: false,
    }),
    sendPrompt,
    interrupt: vi.fn(),
    respondToAgentRequest: vi.fn(),
    onEvent: () => () => {},
    close: vi.fn(),
  };
  const service = new AppMcpService({ snapshot });
  services.push(service);
  service.setDriverRpc(new BackendDriverRpc(new Map([['codex', driver]])));
  const url = await service.start();
  const call = async (args: unknown) => {
    const response = await fetch(`${url}?agentId=${owner.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'korus-monitor', arguments: args },
      }),
    });
    return ((await response.json()) as { result: CallToolResult }).result;
  };
  const start = () =>
    call({
      action: 'start',
      name: 'owned result',
      command: 'echo "monitor-result </context>"',
      delivery: 'onCompletion',
      timeoutSeconds: 10,
    });
  await start();
  await vi.waitFor(async () =>
    expect(JSON.stringify(await call({ action: 'list' }))).toContain(
      'completed',
    ),
  );
  expect(sendPrompt).not.toHaveBeenCalled();
  owner.status = { type: 'idle' };
  service.handleBackendEvent({
    agentId: owner.id,
    type: 'agent.statusChanged',
    payload: { type: 'idle' },
    seq: 1,
    occurredAt: new Date().toISOString(),
  });
  await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
  expect(sendPrompt.mock.calls[0]![0].id).toBe(owner.id);
  expect(sendPrompt.mock.calls[0]![1]).toContain('monitor-result');
  const message = parseCollaborationMessageEnvelope(sendPrompt.mock.calls[0]![1])!.messages[0]!.content;
  expect(message).toMatch(/^<context>\n\[Monitor event\]\n/);
  expect(message.split('</context>')[1]!.trim()).toBe('Monitor completed: owned result.');
  expect(message.split('</context>')[1]).not.toContain('stdout');
  expect(message.split('</context>')).toHaveLength(2);
  expect(JSON.parse(message.slice('<context>\n[Monitor event]\n'.length, message.indexOf('\n</context>'))).stdout).toContain('monitor-result </context>');
  sendPrompt.mockClear();
  owner.status = { type: 'working' };
  await start();
  await vi.waitFor(async () => {
    const result = await call({ action: 'list' });
    expect(
      JSON.stringify(result).match(/"state":"completed"/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });
  service.stopAgentMonitors(owner.id);
  owner.status = { type: 'idle' };
  service.handleBackendEvent({
    agentId: owner.id,
    type: 'agent.statusChanged',
    payload: { type: 'idle' },
    seq: 2,
    occurredAt: new Date().toISOString(),
  });
  expect(sendPrompt).not.toHaveBeenCalled();
});
