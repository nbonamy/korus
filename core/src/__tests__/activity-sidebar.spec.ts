import { describe, expect, it } from 'vitest';
import type { Agent } from '../contracts';
import { projectCompanionWorkspace } from '../companion-projection';
import { projectActivitySidebar, projectWorkspaceSidebar } from '../workspace-sidebar';

describe('shared activity sidebar across the companion boundary', () => {
  it('keeps desktop and phone groups aligned as work finishes and ages, preserving Claude speed', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const agent = (id: string, patch: Partial<Agent> = {}): Agent => ({ id, name: id, teamId: 'team', folder: null, backend: 'codex',
      createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-15T12:00:00Z', status: { type: 'idle' }, ...patch });
    const source = { teams: [{ id: 'team', name: 'Team', agentIds: [] }], agents: [
      agent('waiting', { status: { type: 'awaitingInput' } }),
      agent('recent', { hasSubmittedPrompt: true, lastActivityAt: '2026-10-15T11:59:00Z' }),
      agent('working', { status: { type: 'working' } }),
      agent('created', { createdAt: '2026-10-15T12:00:00Z' }),
      agent('idle', { backend: 'claude', hasSubmittedPrompt: true, lastActivityAt: '2026-10-15T11:00:00Z',
        backendDefaults: { kind: 'claude', model: 'opus', serviceTier: 'fast', permissionMode: 'default' } }),
    ] };
    const wire = projectCompanionWorkspace(source);
    expect(wire.agents.find(a => a.id === 'recent')!.lastActivityAt).toBe('2026-10-15T11:59:00Z');
    expect(wire.agents.find(a => a.id === 'idle')!.backendDefaults).toStrictEqual({ kind: 'claude', model: 'opus', serviceTier: 'fast', permissionMode: 'default' });
    const groups = (agents: Agent[], time: number) => projectActivitySidebar({ agents, now: time,
      repositoryGroups: projectWorkspaceSidebar({ agents, activeAgentId: 'working', quickChatsLabel: 'Chats' }), label: activity => activity });
    const ids = (agents: Agent[], time: number) => groups(agents, time).map(group => [group.activity, group.sessions.map(s => s.agentId)]);
    const expected = [['attention', ['waiting']], ['recent', ['recent', 'created']], ['working', ['working']], ['idle', ['idle']]];
    expect(ids(source.agents, now)).toStrictEqual(expected);
    expect(ids(wire.agents, now)).toStrictEqual(expected);
    const finished = wire.agents.map(a => a.id === 'working' ? { ...a, status: { type: 'idle' as const }, hasSubmittedPrompt: true, lastActivityAt: new Date(now).toISOString() } : a);
    expect(ids(finished, now)).toStrictEqual([['attention', ['waiting']], ['recent', ['recent', 'working', 'created']], ['idle', ['idle']]]);
    expect(ids(finished, now + 300_001)).toStrictEqual([['attention', ['waiting']], ['idle', ['working', 'recent', 'idle', 'created']]]);
    expect(groups(finished, now).flatMap(g => g.sessions).find(s => s.agentId === 'working')!.isActive).toBe(true);
  });
});
