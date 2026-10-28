import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { Agent } from '@workspace/core/contracts';
import type { CompanionMission, CompanionWorkspace } from '@workspace/core/companion-protocol';
import type { CompanionSession } from '../companion-port';

const now = '2026-01-01T00:00:00Z';
const worker = (id: string, teamId: string): Agent => ({ id, teamId, name: null, folder: null, backend: 'codex', status: { type: 'working' }, createdAt: now, updatedAt: now, conversationTitle: `Ticket ${id}` });
const mission = (id: string, teamId: string, tickets: CompanionMission['tickets'], leadAgentId?: string): CompanionMission =>
  ({ id, teamId, outcome: `Outcome of ${id}`, stage: 'implementation', status: 'active', revision: 7, startedAt: now, updatedAt: now, tickets, ...(leadAgentId ? { leadAgentId } : {}) });

/** A laptop with a second team, a mission in each, and the demo chat in the first. */
function missionConnector(actions: Pick<import('../companion-port').CompanionSession, 'continueMission' | 'acceptTicket' | 'selectFinding' | 'fixFindings' | 'rerunReview' | 'finishReview'> = {}, leadAgentId = 'demo-agent') {
  const connector = createDemoConnector(); const connect = connector.connect;
  connector.connect = async id => {
    const session = await connect(id);
    return { ...session, ...actions,
      getWorkspace: async () => {
        const base = await session.getWorkspace();
        return { ...base, teams: [...base.teams, { id: 'other', name: 'Other', agentIds: [] }],
          missionAgents: [{ ...worker('w-here', 'demo-team'), statusText: 'editing gitlab-client.ts' }, worker('w-there', 'other')],
          missionProgress: [
            mission('m-here', 'demo-team', [{ number: 1, title: 'Schema', state: 'accepted' }, { number: 2, title: 'Endpoint', repository: 'billing-service', state: 'running', agentId: 'w-here' }, { number: 3, title: 'Docs', state: 'blocked' }, { number: 4, title: 'Review me', state: 'awaitingReview', agentId: 'w-here', runId: 'run-4' }], leadAgentId),
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
    const connector = missionConnector(), connect = connector.connect;
    let workspace!: CompanionWorkspace;
    let update!: Parameters<NonNullable<CompanionSession['onUpdate']>>[0];
    connector.connect = async id => {
      const session = await connect(id); workspace = await session.getWorkspace();
      return { ...session, getWorkspace: async () => workspace, onUpdate(listener) { update = listener; return () => {}; } };
    };
    const engine = createEngine({ connector, post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      expect(engine.snapshot().missions).toMatchObject([{ id: 'm-here', done: 1, tickets: [{ number: 1 }, { number: 2, agentId: 'w-here', activity: 'editing gitlab-client.ts' }, { number: 3, state: 'blocked' }, { number: 4, state: 'awaitingReview', runId: 'run-4' }] }]);
      // Only a ticket being worked on carries a live line.
      expect(engine.snapshot().missions[0]!.tickets.map((ticket) => 'activity' in ticket)).toStrictEqual([false, true, false, false]);
      for (const [lead, repo, unread, attention] of [
        ['idle', 'awaitingInput', ['demo-agent'], 'needsInput'],
        ['working', 'idle', ['demo-agent', 'w-here'], 'unread'],
        ['idle', 'working', ['w-here'], 'working'],
        ['idle', 'idle', ['w-here'], 'idle'],
        ['awaitingInput', 'working', [], 'needsInput'],
        ['working', 'idle', [], 'working'],
      ] as const) {
        const change = (agent: Agent): Agent => ({ ...agent, status: { type: agent.id === 'demo-agent' ? lead : repo },
          readState: { revision: 2, readRevision: unread.some(id => id === agent.id) ? 1 : 2 } });
        workspace = { ...workspace, agents: workspace.agents.map(change), missionAgents: workspace.missionAgents!.map(change) };
        update(workspace, null); await nextTick();
        expect(engine.snapshot().missions[0]).toMatchObject({ attention });
        expect(engine.snapshot()).toMatchObject({ missionAttention: attention });
      }
    } finally { engine.dispose(); }
  });
  it.each(['demo-agent', 'w-here'])('opens a repository worker separately from the mission lead (%s)', async leadAgentId => {
    const engine = createEngine({ connector: missionConnector({}, leadAgentId), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'w-here' });
      const opened = engine.snapshot();
      expect(opened.agentId).toBe('w-here');
      expect(opened.mission).toStrictEqual({ id: 'm-here', outcome: 'Outcome of m-here' });
      // A repository worker takes precedence even when an older laptop labels it as the lead.
      expect(opened.header).toMatchObject({ title: 'billing-service', repository: null });
      expect(JSON.stringify(opened.groups)).not.toContain('w-here');
      if (leadAgentId === 'w-here') return;
      // The mission's lead is an ordinary agent that belongs to the mission too, and says so.
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(engine.snapshot().mission).toStrictEqual({ id: 'm-here', outcome: 'Outcome of m-here', lead: true });
      expect(engine.snapshot().header).toMatchObject({ title: 'Mission lead', repository: null });
    } finally { engine.dispose(); }
  });
  it('stays where it is when asked to open an agent the laptop does not show', async () => {
    const engine = createEngine({ connector: missionConnector(), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'w-here' });
      await engine.dispatch({ type: 'selectAgent', id: 'not-on-this-laptop' });
      expect(engine.snapshot().agentId).toBe('w-here');
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
  it('moves a mission on and accepts a ready ticket against the revision the phone saw, then shows the laptop\'s answer', async () => {
    const continueMission = vi.fn(async () => {}); const acceptTicket = vi.fn(async () => {});
    const engine = createEngine({ connector: missionConnector({ continueMission, acceptTicket }), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'continueMission', missionId: 'm-here' });
      expect(continueMission).toHaveBeenCalledExactlyOnceWith('m-here', 7);
      await engine.dispatch({ type: 'acceptTicket', missionId: 'm-here', number: 4 });
      expect(acceptTicket).toHaveBeenCalledExactlyOnceWith('m-here', 7, 'run-4');
      expect(engine.snapshot().missionAction).toBe('idle');
      // A ticket that is not waiting for acceptance, or a mission that is gone, never reaches the laptop.
      await engine.dispatch({ type: 'acceptTicket', missionId: 'm-here', number: 2 });
      await engine.dispatch({ type: 'continueMission', missionId: 'gone' });
      expect(acceptTicket).toHaveBeenCalledOnce(); expect(continueMission).toHaveBeenCalledOnce();
    } finally { engine.dispose(); }
  });
  it('says so when the laptop refuses, and lets the person dismiss it', async () => {
    const continueMission = vi.fn(async () => { throw new Error('The mission has changed.'); });
    const engine = createEngine({ connector: missionConnector({ continueMission }), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'continueMission', missionId: 'm-here' });
      expect(engine.snapshot().missionAction).toBe('failed');
      await engine.dispatch({ type: 'dismissMissionAction' });
      expect(engine.snapshot().missionAction).toBe('idle');
    } finally { engine.dispose(); }
  });
  it('chooses findings, fixes them and reviews again against the revision it saw', async () => {
    const selectFinding = vi.fn(async () => {}); const fixFindings = vi.fn(async () => {}); const rerunReview = vi.fn(async () => {}); const finishReview = vi.fn(async () => {});
    const engine = createEngine({ connector: missionConnector({ selectFinding, fixFindings, rerunReview, finishReview }), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectFinding', missionId: 'm-here', findingId: 'f1', selected: true });
      await engine.dispatch({ type: 'fixFindings', missionId: 'm-here' });
      await engine.dispatch({ type: 'rerunReview', missionId: 'm-here' });
      expect(selectFinding).toHaveBeenCalledExactlyOnceWith('m-here', 7, 'f1', true);
      expect(fixFindings).toHaveBeenCalledExactlyOnceWith('m-here', 7);
      expect(rerunReview).toHaveBeenCalledExactlyOnceWith('m-here', 7);
      await engine.dispatch({ type: 'finishReview', missionId: 'm-here' });
      expect(finishReview).toHaveBeenCalledExactlyOnceWith('m-here', 7);
    } finally { engine.dispose(); }
  });
});
