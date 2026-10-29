import type { AgentBackend, AppSnapshot } from '@workspace/core/contracts';
import { closeAgentInSnapshot } from '@workspace/core/agent-manager';
import { AppError } from '@workspace/core/app-error';

export function localProviderAgents(snapshot: AppSnapshot, backend: AgentBackend) {
  return snapshot.agents.filter(agent => agent.backend === backend && !agent.remoteConnectionId);
}

export function validateProviderReset(snapshot: AppSnapshot, backend: AgentBackend, confirmedIds: string[] | undefined): string[] {
  const agents = localProviderAgents(snapshot, backend);
  const ids = agents.map(agent => agent.id);
  if (ids.length && !confirmedIds) throw new AppError('engineSetup.confirmationRequired', 'This provider already has chats. Confirm their removal before changing its setup.');
  if (confirmedIds && (confirmedIds.length !== ids.length || new Set(confirmedIds).size !== ids.length || ids.some(id => !confirmedIds.includes(id)))) {
    throw new AppError('engineSetup.rosterChanged', 'The engine’s agents have changed. Reopen Customize and confirm the updated list.');
  }
  if (agents.some(agent => agent.status.type !== 'idle')) throw new AppError('engineSetup.agentsBusy', 'All affected agents must be idle before changing their setup.');
  const removed = new Set(ids);
  if (snapshot.agents.some(agent => agent.codeReview && (removed.has(agent.codeReview.targetAgentId) || removed.has(agent.codeReview.reviewerAgentId)))) {
    throw new AppError('engineSetup.reviewActive', 'Finish or discard the affected code reviews before changing this setup.');
  }
  if (snapshot.missions?.some(mission => mission.execution?.runs.some(run => (removed.has(run.memberId) || removed.has(run.workerId ?? '')) && ['preparing', 'running', 'awaitingReview'].includes(run.status)))) {
    throw new AppError('engineSetup.missionActive', 'Finish the affected Mission runs before changing this setup.');
  }
  return ids;
}

/** Roster-only removal. Never archives/deletes provider sessions or worktrees. */
export function resetProviderRoster(snapshot: AppSnapshot, ids: string[]): () => void {
  const before = structuredClone({
    teams: snapshot.teams, activeAgentId: snapshot.activeAgentId,
    queuedPrompts: snapshot.queuedPrompts,
    backendApprovals: snapshot.backendApprovals, agentRequests: snapshot.agentRequests,
    agentGitStatuses: snapshot.agentGitStatuses, turnGitDiffs: snapshot.turnGitDiffs,
    subagentTrees: snapshot.subagentTrees, clientPreferences: snapshot.clientPreferences,
    missions: snapshot.missions, automations: snapshot.automations, workBacklog: snapshot.workBacklog,
  });
  // Keep live agent objects: unrelated provider events may arrive while saving.
  const agents = [...snapshot.agents];
  const delegatedBy = new Map(agents.map(agent => [agent.id, agent.delegatedByAgentId]));
  const drafts = snapshot.general.savedPromptDrafts;
  const removed = new Set(ids);
  const keepEntries = <T>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([id]) => !removed.has(id)));
  for (const id of ids) closeAgentInSnapshot(snapshot, id);
  snapshot.queuedPrompts = snapshot.queuedPrompts?.filter(prompt => !removed.has(prompt.agentId));
  snapshot.general.savedPromptDrafts = drafts.filter(draft => !removed.has(draft.agentId));
  snapshot.agentGitStatuses = keepEntries(snapshot.agentGitStatuses);
  snapshot.subagentTrees = keepEntries(snapshot.subagentTrees);
  snapshot.turnGitDiffs = Object.fromEntries(Object.entries(snapshot.turnGitDiffs).filter(([, diff]) => !removed.has(diff.agentId)));
  for (const agent of snapshot.agents) if (removed.has(agent.delegatedByAgentId ?? '')) delete agent.delegatedByAgentId;
  for (const preferences of Object.values(snapshot.clientPreferences ?? {})) {
    if (removed.has(preferences.activeAgentId ?? '')) preferences.activeAgentId = snapshot.activeAgentId;
    preferences.activeAgentByTeam = Object.fromEntries(Object.entries(preferences.activeAgentByTeam ?? {}).filter(([, id]) => !removed.has(id)));
    preferences.agentOrderByTeam = Object.fromEntries(Object.entries(preferences.agentOrderByTeam ?? {}).map(([team, order]) => [team, order.filter(id => !removed.has(id))]));
    preferences.externalApplications = keepEntries(preferences.externalApplications ?? {});
    if (preferences.general?.savedPromptDrafts) preferences.general.savedPromptDrafts = preferences.general.savedPromptDrafts.filter(draft => !removed.has(draft.agentId));
  }
  for (const automation of snapshot.automations) {
    automation.executionLog = automation.executionLog.filter(run => !removed.has(run.agentId ?? ''));
  }
  for (const mission of snapshot.missions ?? []) {
    mission.stageAgentIds = Object.fromEntries(Object.entries(mission.stageAgentIds).filter(([, id]) => !removed.has(id)));
    if (!mission.execution) continue;
    mission.execution.memberIds = mission.execution.memberIds.filter(id => !removed.has(id));
    mission.execution.runs = mission.execution.runs.filter(run => !removed.has(run.memberId) && !removed.has(run.workerId ?? ''));
    mission.execution.deliveries = mission.execution.deliveries?.filter(delivery => !removed.has(delivery.agentId));
  }
  return () => {
    const currentAgents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
    const restoredAgents = agents.map(agent => removed.has(agent.id) ? agent : currentAgents.get(agent.id)).filter(agent => agent !== undefined);
    for (const agent of snapshot.agents) if (!agents.some(previous => previous.id === agent.id)) restoredAgents.push(agent);
    snapshot.agents = restoredAgents;
    // Restore only removed records; retain events from unrelated live engines.
    const restoreEntries = <T>(current: Record<string, T>, previous: Record<string, T>) => ({ ...current, ...Object.fromEntries(Object.entries(previous).filter(([id]) => removed.has(id))) });
    snapshot.backendApprovals = restoreEntries(snapshot.backendApprovals, before.backendApprovals);
    snapshot.agentRequests = restoreEntries(snapshot.agentRequests ?? {}, before.agentRequests ?? {});
    snapshot.agentGitStatuses = restoreEntries(snapshot.agentGitStatuses, before.agentGitStatuses);
    snapshot.subagentTrees = restoreEntries(snapshot.subagentTrees, before.subagentTrees);
    snapshot.turnGitDiffs = { ...snapshot.turnGitDiffs, ...Object.fromEntries(Object.entries(before.turnGitDiffs).filter(([, diff]) => removed.has(diff.agentId))) };
    snapshot.workBacklog.assignments = { ...snapshot.workBacklog.assignments, ...Object.fromEntries(Object.entries(before.workBacklog.assignments).filter(([, assignment]) => removed.has(assignment.agentId))) };
    snapshot.queuedPrompts = restoreRemovedItems(snapshot.queuedPrompts ?? [], before.queuedPrompts ?? [], prompt => prompt.id, prompt => removed.has(prompt.agentId));
    for (const team of snapshot.teams) {
      const previous = before.teams.find(item => item.id === team.id);
      if (!previous) continue;
      team.agentIds = [...previous.agentIds.filter(id => removed.has(id) || team.agentIds.includes(id)), ...team.agentIds.filter(id => !previous.agentIds.includes(id))];
      if (removed.has(previous.activeAgentId ?? '')) team.activeAgentId = previous.activeAgentId;
    }
    if (removed.has(before.activeAgentId ?? '')) snapshot.activeAgentId = before.activeAgentId;
    snapshot.clientPreferences = before.clientPreferences;
    for (const automation of snapshot.automations) {
      const previous = before.automations.find(item => item.id === automation.id);
      automation.executionLog = restoreRemovedItems(automation.executionLog, previous?.executionLog ?? [], run => run.id, run => removed.has(run.agentId ?? ''));
      // Removing agents disables their schedules and fails their runs; undo that too.
      if (previous && ((previous.target.kind !== 'newQuickChat' && removed.has(previous.target.agentId)) || previous.executionLog.some(run => removed.has(run.agentId ?? '')))) {
        Object.assign(automation, { enabled: previous.enabled, updatedAt: previous.updatedAt });
        if (previous.lastError === undefined) delete automation.lastError; else automation.lastError = previous.lastError;
      }
    }
    for (const mission of snapshot.missions ?? []) {
      const previous = before.missions?.find(item => item.id === mission.id);
      if (!previous) continue;
      Object.assign(mission.stageAgentIds, Object.fromEntries(Object.entries(previous.stageAgentIds).filter(([, id]) => removed.has(id))));
      if (!mission.execution || !previous.execution) continue;
      mission.execution.memberIds = restoreRemovedItems(mission.execution.memberIds, previous.execution.memberIds, id => id, id => removed.has(id));
      mission.execution.runs = restoreRemovedItems(mission.execution.runs, previous.execution.runs, run => run.id, run => removed.has(run.memberId) || removed.has(run.workerId ?? ''));
      mission.execution.deliveries = restoreRemovedItems(mission.execution.deliveries ?? [], previous.execution.deliveries ?? [], delivery => `${delivery.agentId}:${delivery.repositoryPath}`, delivery => removed.has(delivery.agentId));
    }
    for (const agent of snapshot.agents) {
      const previous = delegatedBy.get(agent.id);
      if (previous && removed.has(previous)) agent.delegatedByAgentId = previous;
    }
    snapshot.general.savedPromptDrafts = restoreRemovedItems(snapshot.general.savedPromptDrafts, drafts, draft => draft.id, draft => removed.has(draft.agentId));
  };
}

function restoreRemovedItems<T>(current: T[], previous: T[], key: (item: T) => string, wasRemoved: (item: T) => boolean): T[] {
  const live = new Map(current.map(item => [key(item), item]));
  const originalKeys = new Set(previous.map(key));
  const restored = previous.flatMap(item => wasRemoved(item) ? [item] : live.has(key(item)) ? [live.get(key(item))!] : []);
  return [...restored, ...current.filter(item => !originalKeys.has(key(item)))];
}
