import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createMissionStartToolModuleProvider } from '../mission-start-tools';
import { AppMcpService } from '../service';

describe('create-mission tool', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

  async function setup(prepare?: (snapshot: ReturnType<typeof createInitialSnapshot>) => void) {
    const snapshot = createInitialSnapshot();
    prepare?.(snapshot);
    const startMission = vi.fn(async (_agentId: string, input: { outcome: string; prompt: string }) => ({ missionId: 'mission-1', outcome: input.outcome }));
    const service = new AppMcpService({ snapshot, toolModuleProviders: [createMissionStartToolModuleProvider({ snapshot, startMission })] });
    cleanups.push(() => service.stop());
    const url = await service.start();
    const request = async (method: string, params: unknown, agentId = snapshot.agents[0]!.id) => {
      const response = await fetch(`${url}?agentId=${agentId}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return (await response.json() as { result: { tools: { name: string }[]; isError?: boolean; content: { text?: string }[]; structuredContent: Record<string, unknown> } }).result;
    };
    return { snapshot, startMission, request, call: (args: unknown) => request('tools/call', { name: 'create-mission', arguments: args }) };
  }

  it('starts a mission for the calling agent and reports it', async () => {
    const { snapshot, startMission, request, call } = await setup();
    expect((await request('tools/list', {})).tools.map(tool => tool.name)).toContain('create-mission');
    const result = await call({ outcome: 'Add CSV export', prompt: 'Goal: export the report.' });
    expect(result.isError).toBe(false);
    expect(startMission).toHaveBeenCalledExactlyOnceWith(snapshot.agents[0]!.id, { outcome: 'Add CSV export', prompt: 'Goal: export the report.' });
    expect(result.structuredContent).toMatchObject({ success: true, missionId: 'mission-1', outcome: 'Add CSV export' });
  });

  it('is not offered to agents without a team or to mission workers', async () => {
    const withoutTeam = await setup(snapshot => { delete snapshot.agents[0]!.teamId; });
    expect((await withoutTeam.request('tools/list', {})).tools.map(tool => tool.name)).not.toContain('create-mission');
    const worker = await setup(snapshot => {
      snapshot.missions = [{ execution: { runs: [{ workerId: snapshot.agents[0]!.id }] } } as never];
    });
    expect((await worker.request('tools/list', {})).tools.map(tool => tool.name)).not.toContain('create-mission');
  });

  it('rejects empty or oversized input and surfaces start failures as tool errors', async () => {
    const { startMission, call } = await setup();
    expect((await call({ outcome: '  ', prompt: 'x' })).isError).toBe(true);
    expect((await call({ outcome: 'x'.repeat(201), prompt: 'x' })).isError).toBe(true);
    expect(startMission).not.toHaveBeenCalled();
    startMission.mockRejectedValueOnce(new Error('Choose a local team.'));
    const failed = await call({ outcome: 'Add CSV export', prompt: 'Goal' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]!.text).toContain('Choose a local team.');
  });
});
