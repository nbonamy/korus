import type { Agent } from './contracts';
import type { Mission } from './mission-types';
import { featureStages } from './mission-workflows';

/** Agent activity aggregated across the Mission lead and repository workers, in priority order. */
export type MissionAttention = 'needsInput' | 'unread' | 'working' | 'idle';
export type AgentAttention = 'needsInput' | 'unread';

/** The lead and every worker of a Mission, once each, in the order they appear. */
export function missionAgentIds(mission: Mission): string[] {
  const ids = new Set<string>();
  for (const run of mission.execution?.runs ?? []) if (run.workerId) ids.add(run.workerId);
  for (const agentId of Object.values(mission.stageAgentIds ?? {})) if (agentId) ids.add(agentId);
  return [...ids];
}

/** The current or latest earlier stage's lead; repository implementation workers never lead the Mission. */
export function missionLeadAgentId(mission: Mission): string | undefined {
  for (let index = featureStages.indexOf(mission.stage); index >= 0; index--) {
    const stage = featureStages[index]!;
    if (stage === 'implementation') continue;
    const id = mission.stageAgentIds?.[stage];
    if (id) return id;
  }
  return undefined;
}

/** Global unread badges follow visible conversations and each Mission's current lead. */
export function navigationUnreadAgentIds(missions: readonly Mission[], unreadAgentIds: readonly string[]): string[] {
  const owned = new Set(missions.flatMap(missionAgentIds));
  const leads = new Set(missions.map(missionLeadAgentId).filter((id): id is string => Boolean(id)));
  return unreadAgentIds.filter(id => !owned.has(id) || leads.has(id));
}

export function agentAttention(agent: Pick<Agent, 'id' | 'status'> | undefined, unreadAgentIds: ReadonlySet<string>): AgentAttention | null {
  if (!agent) return null;
  if (agent.status.type === 'awaitingInput') return 'needsInput';
  return unreadAgentIds.has(agent.id) ? 'unread' : null;
}

/** Shared desktop/mobile priority: any input request, unread lead, any working agent, then idle. */
export function missionAgentsAttention(agents: readonly Pick<Agent, 'id' | 'status'>[], leadAgentIds: ReadonlySet<string>, unreadAgentIds: ReadonlySet<string>): MissionAttention {
  if (agents.some(agent => agent.status.type === 'awaitingInput')) return 'needsInput';
  if (agents.some(agent => leadAgentIds.has(agent.id) && unreadAgentIds.has(agent.id))) return 'unread';
  return agents.some(agent => agent.status.type === 'working') ? 'working' : 'idle';
}

export function missionAttention(mission: Mission, agents: readonly Pick<Agent, 'id' | 'status'>[], unreadAgentIds: ReadonlySet<string>): MissionAttention {
  const own = new Set(missionAgentIds(mission));
  const members = agents.filter(agent => own.has(agent.id));
  const lead = missionLeadAgentId(mission);
  return missionAgentsAttention(members, new Set(lead ? [lead] : []), unreadAgentIds);
}
