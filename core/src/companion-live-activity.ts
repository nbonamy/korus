import type { AgentBackend } from './contracts';
import type { CompanionWorkspace } from './companion-protocol';
import { agentDisplayName } from './agent-display';

/** A separate, opt-in APNs channel; ordinary notification tokens cannot authorize it. */
export const companionLiveActivityProtocol = '/workspace/companion-live-activity/1.0.0';
export type WorkActivityAgent = { id: string; name: string; backend?: AgentBackend; startedAt?: number; status: 'idle' | 'working' | 'approval' | 'question' | 'waiting' | 'error'; detail: string };
export type WorkActivityState = { hostName?: string; active?: number; running: number; attention: number; agents: WorkActivityAgent[]; more: number };
export type LiveActivityRegistration = { token: string; environment: 'development' | 'production';
  authorization?: { expiresAt: number; signature: string } } & ({ kind: 'start' } | { kind: 'update'; instanceId: string });
export type LiveActivityPush = { hostId: string; instanceId: string; startedAt: number; timestamp: number; event: 'start' | 'update' | 'end'; state: WorkActivityState };

export function liveActivityAuthorizationMessage(relayId: string, hostId: string, peerId: string, registration: LiveActivityRegistration, expiresAt: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['companion-live-activity-consent-v1', relayId, hostId, peerId,
    registration.kind, registration.kind === 'update' ? registration.instanceId : null, registration.token, registration.environment, expiresAt]));
}

/** Count each agent once across teams and Mission workers, without exposing conversation content. */
export function workActivityState(workspace: CompanionWorkspace, previous?: WorkActivityState, observedAt?: number): WorkActivityState {
  const teams = new Set(workspace.teams.map(team => team.id));
  const agents = new Map([...workspace.agents, ...workspace.missionAgents ?? []].filter(agent => agent.teamId !== undefined && teams.has(agent.teamId)).map(agent => [agent.id, agent]));
  let running = 0; let attention = 0;
  const rows: WorkActivityAgent[] = [];
  const bounded = (text: string, limit: number) => Array.from(text.replace(/[\r\n\t]/gu, ' ').trim()).slice(0, limit).join('');
  for (const agent of agents.values()) {
    if (agent.status.type === 'working') running++;
    const requests = workspace.agentRequests?.[agent.id] ?? [];
    attention += requests.length || (agent.status.type === 'awaitingInput' || agent.status.type === 'error' ? 1 : 0);
    const status: WorkActivityAgent['status'] | undefined = requests.length ? requests.some(request => request.kind !== 'question') ? 'approval' : 'question'
      : agent.status.type === 'awaitingInput' ? 'waiting' : agent.status.type === 'error' ? 'error' : agent.status.type === 'working' ? 'working' : previous?.agents.some(row => row.id === agent.id) ? 'idle' : undefined;
    const startedAt = status && status !== 'idle' ? previous?.agents.find(row => row.id === agent.id)?.startedAt ?? observedAt : undefined;
    if (status) rows.push({ id: agent.id, name: bounded(agentDisplayName(agent), 80), backend: agent.backend, ...(startedAt ? { startedAt } : {}), status,
      detail: status === 'working' ? bounded(agent.statusText || 'Working', 100)
        : { idle: 'Idle', approval: 'Needs your approval', question: 'Has a question', waiting: 'Waiting for input', error: 'Needs attention' }[status] });
  }
  const priority = (row: WorkActivityAgent) => row.status === 'idle' ? 2 : row.status === 'working' ? 1 : 0;
  rows.sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
  const visible = rows.slice(0, 2);
  const previousIndex = new Map(previous?.agents.map((row, index) => [row.id, index]));
  // Keep row identity stable as work finishes; new active agents can still replace idle rows.
  visible.sort((a, b) => priority(a) - priority(b)
    || (previousIndex.get(a.id) ?? 2) - (previousIndex.get(b.id) ?? 2) || a.id.localeCompare(b.id));
  return { active: rows.filter(row => row.status !== 'idle').length, running, attention, agents: visible, more: Math.max(0, rows.length - 2) };
}
