import { product } from '@workspace/core/product';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import { missionRunAssignment, type MissionRun } from '@workspace/core/mission-execution';

export function missionAgent(snapshot: AppSnapshot, id: string | undefined): Agent | undefined {
  return snapshot.agents.find(agent => agent.id === id);
}

export function missionTeamRepositories(snapshot: AppSnapshot, mission: Mission): string[] {
  const team = snapshot.teams.find(candidate => candidate.id === mission.teamId);
  const workerIds = new Set((snapshot.missions ?? []).flatMap(candidate => (
    candidate.execution?.runs.flatMap(run => run.workerId && run.workerId !== run.memberId ? [run.workerId] : []) ?? []
  )));
  return [...new Set((team?.agentIds ?? []).flatMap(id => {
    if (workerIds.has(id)) return [];
    const agent = missionAgent(snapshot, id);
    if (!agent || agent.teamId !== team?.id) return [];
    if (agent.workspace?.kind === 'git') return [agent.workspace.primaryWorktreeRoot];
    return agent.folder ? [agent.folder] : [];
  }))];
}

export function missionWorkspaceName(mission: Mission): string {
  const outcome = mission.outcome
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'mission';
  const suffix = mission.id.replace(/^mission-/, '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase();
  return `${outcome}-${suffix || 'work'}`;
}

export function stageKickoffPrompt(mission: Mission, run: MissionRun): string {
  if (run.stage === 'tickets') return `The requirements are approved. Continue this Mission in the Tickets stage now: follow the assigned ${product.name} Mission skill, then work with the user to shape and publish the backlog.`;
  if (run.stage === 'implementation') return `The tickets are approved. Begin assigned ticket ${missionRunAssignment(mission, run)?.ticketNumber ?? (run.ticketIndex ?? 0) + 1}. Your assignment is ${JSON.stringify(missionRunAssignment(mission, run))}. Read get-mission-assignment, then implement only this ticket in your assigned worktree. Report progress in this Mission conversation and submit summary, ticketId and implementation evidence through submit-mission-result.`;
  return 'The implementation is approved. Begin the Mission review now and prepare the delivery decision for the user.';
}

export function sameSkills(left: MissionRun['skills'], right: MissionRun['skills']): boolean {
  return left.length === right.length && left.every((skill, index) => skill.name === right[index]?.name && skill.path === right[index]?.path);
}
