import type { Mission } from '@workspace/core/missions';
import type { UsageSummary } from '@workspace/core/usage';
import { agentCostFor, type AgentCost } from './agent-cost';

/** `label` is the repository's folder name; the lead and the catch-all line have none and are named by the screen. */
export type MissionCostRow = { id: 'lead' | 'other' | (string & {}); label: string | null; cost: AgentCost | null };

const leadStages = new Set(['requirements', 'tickets']);

/** What a Mission cost: its lead, each repository's implementers, anything else, and the total. An agent counts once, in the first group that claims it. */
export function missionCostGroups(mission: Mission, summary: UsageSummary | null): { rows: MissionCostRow[]; total: AgentCost | null } {
  const lead = new Set<string>();
  const byRepository = new Map<string, Set<string>>();
  const other = new Set<string>();
  const claimed = new Set<string>();
  const claim = (group: Set<string>, agentId: string | undefined) => {
    if (!agentId || claimed.has(agentId)) return;
    claimed.add(agentId);
    group.add(agentId);
  };
  const runs = mission.execution?.runs ?? [];
  // The lead keeps its own line even when it is reused for later stages.
  for (const run of runs) if (leadStages.has(run.stage)) claim(lead, run.workerId);
  for (const [stage, agentId] of Object.entries(mission.stageAgentIds)) if (leadStages.has(stage)) claim(lead, agentId);
  for (const run of runs) {
    if (leadStages.has(run.stage)) continue;
    const repository = run.repositoryPath ?? mission.artifacts.tickets[run.ticketIndex ?? -1]?.repositoryPath;
    if (repository) {
      if (!byRepository.has(repository)) byRepository.set(repository, new Set());
      claim(byRepository.get(repository)!, run.workerId);
    } else {
      claim(other, run.workerId);
    }
  }
  for (const agentId of Object.values(mission.stageAgentIds)) claim(other, agentId);

  const groups: { id: string; label: string | null; agents: Set<string> }[] = [
    { id: 'lead', label: null, agents: lead },
    ...[...byRepository].map(([path, agents]) => ({ id: path, label: path.split('/').filter(Boolean).at(-1) ?? path, agents })),
    { id: 'other', label: null, agents: other },
  ];
  const rows = groups
    .map(group => ({ id: group.id, label: group.label, cost: agentCostFor(summary, [...group.agents]) }))
    .filter(row => row.cost !== null);
  return { rows, total: agentCostFor(summary, [...claimed]) };
}
