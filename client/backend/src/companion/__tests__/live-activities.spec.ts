import { describe, expect, it, vi } from 'vitest';
import { CompanionLiveActivities, type SavedLiveActivities } from '../live-activities';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { LiveActivityRegistration, LiveActivityPush } from '@workspace/core/companion-live-activity';

// Owning daemon workflow: Apple accepts one start, iOS returns its update token, counts
// change, the daemon restarts, and work finishes. No transcript or phone runtime fake.
function fixture() {
  let now = 1_800_000_000_000; let allowed = true;
  const agent = (id: string, teamId: string) => ({ id, teamId, name: id, folder: null, backend: 'codex' as const, status: { type: 'working' as const }, createdAt: '', updatedAt: '' });
  const workspace: CompanionWorkspace = { teams: [{ id: 'one', name: 'One', agentIds: ['a', 'm'] }, { id: 'two', name: 'Two', agentIds: ['b'] }], agents: [agent('a', 'one'), agent('b', 'two')], missionAgents: [agent('a', 'one'), agent('m', 'one')],
    agentRequests: { a: [{ id: 'q', kind: 'toolConfirmation', conversationId: 's', confirmation: {} } as never] } };
  const push = vi.fn(async (_peer: string, _registration: LiveActivityRegistration, _activity: LiveActivityPush) => 'sent' as const);
  let saved: SavedLiveActivities = {};
  const create = () => new CompanionLiveActivities({ hostId: 'host', hostName: 'Laptop', initial: saved, authorized: () => allowed,
    workspace: async () => workspace, push, save: async state => { saved = structuredClone(state); }, now: () => now });
  const start: LiveActivityRegistration = { kind: 'start', token: 'ab'.repeat(32), environment: 'development' };
  return { create, start, push, workspace, advance: (milliseconds = 15_000) => { now += milliseconds; }, revoke: () => { allowed = false; }, saved: () => saved };
}
describe('aggregate Live Activity daemon lifecycle', () => {
  it('keeps one activity across all teams and a daemon restart, updates rotated tokens, then ends at idle', async () => {
    const f = fixture(); let service = f.create();
    await service.register('phone', f.start);
    expect(f.push).toHaveBeenCalledExactlyOnceWith('phone', f.start, { event: 'start', hostId: 'host', instanceId: expect.any(String), timestamp: 1_800_000_000, startedAt: 1_800_000_000_000, state: { hostName: 'Laptop', active: 3, running: 3, attention: 1, agents: [{ id: 'a', name: 'a', backend: 'codex', startedAt: 1_800_000_000_000, status: 'approval', detail: 'Needs your approval' }, { id: 'b', name: 'b', backend: 'codex', startedAt: 1_800_000_000_000, status: 'working', detail: 'Working' }], more: 1 } });
    const instanceId = f.push.mock.calls[0]![2].instanceId;
    await service.refresh(); await service.refresh();
    expect(f.push).toHaveBeenCalledTimes(1);
    const update: LiveActivityRegistration = { ...f.start, kind: 'update', instanceId, token: 'cd'.repeat(32) };
    await service.register('phone', update);
    expect(f.push).toHaveBeenLastCalledWith('phone', update, expect.objectContaining({ event: 'update', state: { hostName: 'Laptop', active: 3, running: 3, attention: 1, agents: [{ id: 'a', name: 'a', backend: 'codex', startedAt: 1_800_000_000_000, status: 'approval', detail: 'Needs your approval' }, { id: 'b', name: 'b', backend: 'codex', startedAt: 1_800_000_000_000, status: 'working', detail: 'Working' }], more: 1 } }));
    service = f.create(); f.advance();
    await service.refresh();
    expect(f.push).toHaveBeenCalledTimes(2);
    f.workspace.agents[0]!.status = { type: 'idle' } as never; f.workspace.missionAgents = []; f.workspace.agentRequests = {};
    f.advance(); await service.refresh();
    expect(f.push).toHaveBeenLastCalledWith('phone', update, expect.objectContaining({ event: 'update', state: { hostName: 'Laptop', active: 1, running: 1, attention: 0, agents: [{ id: 'b', name: 'b', backend: 'codex', startedAt: 1_800_000_000_000, status: 'working', detail: 'Working' }, { id: 'a', name: 'a', backend: 'codex', status: 'idle', detail: 'Idle' }], more: 0 } }));
    let rotated = { ...update, token: 'ef'.repeat(32) };
    f.advance(); await service.register('phone', rotated);
    expect(f.push).toHaveBeenLastCalledWith('phone', rotated, expect.objectContaining({ event: 'update' }));
    expect(f.push.mock.lastCall![2].state.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b', startedAt: 1_800_000_000_000 })]));
    f.advance(8 * 3600_000); await service.refresh();
    expect(f.push).toHaveBeenLastCalledWith('phone', f.start, expect.objectContaining({ event: 'start' }));
    const renewedId = f.push.mock.lastCall![2].instanceId;
    expect(renewedId).not.toBe(instanceId);
    expect(f.push.mock.lastCall![2]).toEqual(expect.objectContaining({ startedAt: 1_800_000_000_000 + 8 * 3600_000 + 3 * 15_000 }));
    rotated = { ...rotated, instanceId: renewedId };
    await service.register('phone', rotated);
    // Dismissing on iPhone invalidates the token: don't start again while work continues.
    f.push.mockResolvedValueOnce('invalid' as never);
    f.workspace.agentRequests = { b: [{ id: 'q', kind: 'toolConfirmation' } as never] };
    f.advance(); await service.refresh();
    const dismissedSends = f.push.mock.calls.length;
    f.advance(); await service.refresh();
    expect(f.push).toHaveBeenCalledTimes(dismissedSends);
    f.workspace.agentRequests = {};
    f.workspace.agents = []; f.advance(); await service.refresh();
    expect(f.saved().phone?.instanceId).toBeUndefined();
    await expect(service.register('phone', update)).rejects.toThrow('Activity changed');
    f.revoke(); await service.refresh();
    expect(f.saved()).toStrictEqual({});
  });
  it('handles a finish before the token arrives and never retries an uncertain start into duplicate activities', async () => {
    const f = fixture(); const service = f.create();
    f.push.mockResolvedValueOnce('unavailable' as never);
    await expect(service.register('phone', f.start)).rejects.toThrow('unavailable');
    let instanceId = f.push.mock.calls[0]![2].instanceId;
    f.advance(); await service.refresh();
    expect(f.push).toHaveBeenCalledTimes(1);
    await service.register('phone', f.start);
    expect(f.push).toHaveBeenLastCalledWith('phone', f.start, expect.objectContaining({ event: 'start', instanceId }));
    // An accepted start can outlive the native activity after an app upgrade.
    // A foreground registration may replace it after its stale window, but a
    // heartbeat or an immediate retry must never send a second start.
    const acceptedSends = f.push.mock.calls.length;
    await service.register('phone', f.start);
    expect(f.push).toHaveBeenCalledTimes(acceptedSends);
    f.advance(901_000); await service.refresh();
    expect(f.push).toHaveBeenCalledTimes(acceptedSends);
    await f.create().register('phone', f.start);
    expect(f.push).toHaveBeenCalledTimes(acceptedSends + 1);
    const replacementId = f.push.mock.lastCall![2].instanceId;
    expect(replacementId).not.toBe(instanceId);
    await expect(f.create().register('phone', { ...f.start, kind: 'update', instanceId })).rejects.toThrow('Activity changed');
    instanceId = replacementId;
    const resumed = f.create();
    f.workspace.agents = []; f.workspace.missionAgents = []; f.workspace.agentRequests = {};
    await resumed.refresh();
    await resumed.register('phone', { ...f.start, kind: 'update', instanceId });
    expect(f.push).toHaveBeenLastCalledWith('phone', expect.objectContaining({ kind: 'update' }), expect.objectContaining({ event: 'end' }));
    await resumed.register('phone', null);
    expect(f.saved()).toStrictEqual({});
  });
});
