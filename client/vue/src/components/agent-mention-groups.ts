import type { ComposerMentionGroup as CodexComposerMentionGroup, ComposerMentionItem as CodexComposerMentionItem } from '@korus-dev/agent-ui-sdk';
import type { Agent } from '@workspace/core/contracts';
import { missionAgentIds, missionLeadAgentId } from '@workspace/core/mission-attention';
import { missionRunTicketIndex } from '@workspace/core/mission-execution';
import type { Mission, MissionRun } from '@workspace/core/mission-types';
import { projectAgentMentionLabels } from '@workspace/core/workspace-sidebar';

/** Mention sections follow the Mission's lead/repository conversations, without worktree names. */
export function agentMentionGroups(input: {
  agents: readonly Agent[];
  missions: readonly Mission[];
  activeMissionId: string | null;
  agentsLabel: string;
  missionLabel: string;
  quickChatsLabel: string;
  leadLabel: string;
  builderLabel: string;
}): CodexComposerMentionGroup[] {
  const available = new Map(input.agents.map(agent => [agent.id, agent]));
  const owned = new Set(input.missions.flatMap(missionAgentIds));
  const groups: CodexComposerMentionGroup[] = [];
  const ordinary = projectAgentMentionLabels(input.agents.filter(agent => !owned.has(agent.id)), input.quickChatsLabel);
  if (ordinary.length) groups.push({
    id: 'agents', label: input.agentsLabel, placement: 'before',
    items: ordinary.map(({ agentId, label }) => mention(agentId, label)),
  });
  for (const mission of input.missions) {
    const runs = mission.execution?.runs ?? [];
    const lead = missionLeadAgentId(mission)
      ?? [...runs].reverse().find(run => run.stage !== 'implementation' && run.workerId && available.has(run.workerId))?.workerId;
    const workers = new Map<string, MissionRun | undefined>(runs.filter(run => run.stage === 'implementation' && run.workerId && available.has(run.workerId))
      .map(run => [run.workerId!, run]));
    // Legacy Missions may have stage agents without execution runs.
    const legacyWorker = mission.stageAgentIds?.implementation;
    if (legacyWorker && available.has(legacyWorker) && !workers.has(legacyWorker)) {
      workers.set(legacyWorker, undefined);
    }
    const items: CodexComposerMentionItem[] = [];
    if (lead && available.has(lead)) items.push(mention(lead, input.leadLabel, mission.outcome));
    const repositoryWorkers = [...workers].filter(([id]) => id !== lead).map(([id, run]) => {
      const agent = available.get(id)!;
      const index = run && missionRunTicketIndex(mission, run);
      const repositoryPath = run?.repositoryPath ?? mission.artifacts.tickets[index ?? -1]?.repositoryPath;
      const label = repositoryPath?.split(/[\\/]/u).filter(Boolean).at(-1)
        ?? (agent.workspace?.kind === 'git' ? agent.workspace.repositoryName : undefined)
        ?? input.builderLabel;
      return { id, label };
    });
    for (const worker of repositoryWorkers) {
      const siblings = repositoryWorkers.filter(candidate => candidate.label === worker.label);
      const label = siblings.length > 1 ? `${worker.label} · ${siblings.indexOf(worker) + 1}` : worker.label;
      items.push(mention(worker.id, label, mission.outcome));
    }
    if (items.length) groups.push({ id: `mission:${mission.id}`, label: `${input.missionLabel} • ${mission.outcome}`, placement: 'before', items });
  }
  const current = groups.findIndex(group => group.id === `mission:${input.activeMissionId}`);
  if (current > 0) groups.unshift(...groups.splice(current, 1));
  return groups;
}

function mention(agentId: string, label: string, description?: string): CodexComposerMentionItem {
  return { id: agentId, value: `agent:${agentId}`, label, ...(description ? { description } : {}), payload: { agentId } };
}
