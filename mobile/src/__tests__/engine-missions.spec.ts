import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { Agent } from '@workspace/core/contracts';
import type { CompanionMission } from '@workspace/core/companion-protocol';

const now = '2026-01-01T00:00:00Z';
const worker = (id: string, teamId: string): Agent => ({ id, teamId, name: null, folder: null, backend: 'codex', status: { type: 'working' }, createdAt: now, updatedAt: now, conversationTitle: `Ticket ${id}` });
const mission = (id: string, teamId: string, tickets: CompanionMission['tickets']): CompanionMission =>
  ({ id, teamId, outcome: `Outcome of ${id}`, stage: 'implementation', status: 'active', startedAt: now, updatedAt: now, tickets });

/** A laptop with a second team, a mission in each, and the demo chat in the first. */
function missionConnector() {
  const connector = createDemoConnector(); const connect = connector.connect;
  connector.connect = async id => {
    const session = await connect(id);
    return { ...session,
      getWorkspace: async () => {
        const base = await session.getWorkspace();
        return { ...base, teams: [...base.teams, { id: 'other', name: 'Other', agentIds: [] }],
          missionAgents: [{ ...worker('w-here', 'demo-team'), statusText: 'editing gitlab-client.ts' }, worker('w-there', 'other')],
          missionProgress: [
            mission('m-here', 'demo-team', [{ number: 1, title: 'Schema', state: 'accepted' }, { number: 2, title: 'Endpoint', state: 'running', agentId: 'w-here' }, { number: 3, title: 'Docs', state: 'blocked' }]),
            mission('m-there', 'other', [{ number: 1, title: 'Elsewhere', state: 'running', agentId: 'w-there' }])],
        };
      },
      loadConversation: async agentId => {
        const frame = await session.loadConversation(agentId.startsWith('w-') ? 'demo-agent' : agentId);
        return frame && agentId.startsWith('w-') ? { ...frame, agentId } as typeof frame : frame;
      },
    };
  };
  return connector;
}

describe('mobile missions', () => {
  it('lists the open team\'s missions with how many tickets are accepted', async () => {
    const engine = createEngine({ connector: missionConnector(), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(engine.snapshot().missions).toMatchObject([{ id: 'm-here', done: 1, tickets: [{ number: 1 }, { number: 2, agentId: 'w-here', activity: 'editing gitlab-client.ts' }, { number: 3, state: 'blocked' }] }]);
      // Only a ticket being worked on carries a live line.
      expect(engine.snapshot().missions[0]!.tickets.map((ticket) => 'activity' in ticket)).toStrictEqual([false, true, false]);
      expect(engine.snapshot().mission).toBeNull();
    } finally { engine.dispose(); }
  });
  it('opens a ticket\'s worker as a conversation of its mission, without adding it to the sidebar', async () => {
    const engine = createEngine({ connector: missionConnector(), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'w-here' });
      const opened = engine.snapshot();
      expect(opened.agentId).toBe('w-here');
      expect(opened.mission).toStrictEqual({ id: 'm-here', outcome: 'Outcome of m-here' });
      expect(opened.header).toMatchObject({ title: 'Ticket w-here', repository: null });
      expect(JSON.stringify(opened.groups)).not.toContain('w-here');
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(engine.snapshot().mission).toBeNull();
    } finally { engine.dispose(); }
  });
  it('switches to the mission\'s team when its worker belongs to another one', async () => {
    const engine = createEngine({ connector: missionConnector(), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAllTeams' });
      expect(engine.snapshot().missions.map(({ id }) => id)).toStrictEqual(['m-here', 'm-there']);
      await engine.dispatch({ type: 'selectAgent', id: 'w-there' });
      expect(engine.snapshot()).toMatchObject({ teamId: 'other', agentId: 'w-there', mission: { id: 'm-there' } });
    } finally { engine.dispose(); }
  });
});
