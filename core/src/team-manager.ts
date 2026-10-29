import type { AppSnapshot, CreateTeamInput, Team, UpdateTeamInput } from './contracts';
import { releaseRemovedAutomationTargetsInSnapshot } from './automation-manager';
import { defaultTeamColor, teamColors } from './team-colors';

export function createTeamInSnapshot(
  snapshot: AppSnapshot,
  input: CreateTeamInput,
  createdAt = new Date().toISOString(),
  options: { select?: boolean } = {},
): Team {
  const name = normalizedTeamName(input.name);
  const color = normalizedTeamColor(input.color);
  const team: Team = {
    id: uniqueTeamId(snapshot, name, createdAt),
    name,
    avatar: teamInitials(name),
    color,
    agentIds: [],
  };

  snapshot.teams.push(team);
  if (options.select !== false) {
    snapshot.activeTeamId = team.id;
    snapshot.activeAgentId = null;
  }
  return team;
}

export function selectTeam(snapshot: AppSnapshot, teamId: string): AppSnapshot {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    return snapshot;
  }

  snapshot.activeTeamId = team.id;
  const activeAgentId = team.activeAgentId && team.agentIds.includes(team.activeAgentId)
    ? team.activeAgentId
    : team.agentIds[0] ?? null;
  snapshot.activeAgentId = activeAgentId;
  if (activeAgentId) {
    team.activeAgentId = activeAgentId;
  }
  return snapshot;
}

export function updateTeamInSnapshot(snapshot: AppSnapshot, input: UpdateTeamInput): Team | null {
  const team = snapshot.teams.find((candidate) => candidate.id === input.id);
  if (!team) {
    return null;
  }

  team.name = normalizedTeamName(input.name);
  team.avatar = teamInitials(team.name);
  team.color = normalizedTeamColor(input.color);
  return team;
}

export function reorderTeamInSnapshot(snapshot: AppSnapshot, teamId: string, beforeTeamId: string | null): Team | null {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    return null;
  }

  if (beforeTeamId === teamId) {
    return team;
  }

  if (beforeTeamId !== null && !snapshot.teams.some((candidate) => candidate.id === beforeTeamId)) {
    return null;
  }

  snapshot.teams = reorderByBeforeId(snapshot.teams, team, beforeTeamId);
  return team;
}

export function closeTeamInSnapshot(snapshot: AppSnapshot, teamId: string): Team | null {
  if (snapshot.teams.length <= 1) {
    throw new Error('At least one team must remain open.');
  }

  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    return null;
  }

  const closedAgentIds = new Set(team.agentIds);
  snapshot.teams = snapshot.teams.filter((candidate) => candidate.id !== teamId);
  snapshot.agents = snapshot.agents.filter((agent) => !closedAgentIds.has(agent.id));
  if (snapshot.missions) snapshot.missions = snapshot.missions.filter((mission) => mission.teamId !== teamId);
  releaseRemovedAutomationTargetsInSnapshot(snapshot);

  if (snapshot.activeTeamId === teamId || !snapshot.teams.some((candidate) => candidate.id === snapshot.activeTeamId)) {
    snapshot.activeTeamId = snapshot.teams[0]?.id ?? null;
  }

  const activeTeam = snapshot.teams.find((candidate) => candidate.id === snapshot.activeTeamId) ?? snapshot.teams[0] ?? null;
  if (closedAgentIds.has(snapshot.activeAgentId ?? '') || !snapshot.agents.some((agent) => agent.id === snapshot.activeAgentId)) {
    snapshot.activeAgentId = activeTeam?.activeAgentId && activeTeam.agentIds.includes(activeTeam.activeAgentId)
      ? activeTeam.activeAgentId
      : activeTeam?.agentIds[0] ?? null;
  }

  if (activeTeam && snapshot.activeAgentId) {
    activeTeam.activeAgentId = snapshot.activeAgentId;
  }

  return team;
}

export function teamInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '?';
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  return trimmed.slice(0, 2).toUpperCase();
}

function normalizedTeamName(name: string): string {
  return name.trim() || 'Team';
}

function normalizedTeamColor(color: string): string {
  const normalized = color.trim().toUpperCase();
  return teamColors.find((candidate) => candidate === normalized) ?? defaultTeamColor;
}

function uniqueTeamId(snapshot: AppSnapshot, name: string, createdAt: string): string {
  const baseId = `team-${slug(name)}-${createdAt.replace(/\W/g, '').toLowerCase()}`;
  if (!snapshot.teams.some((team) => team.id === baseId)) {
    return baseId;
  }

  let counter = 2;
  while (snapshot.teams.some((team) => team.id === `${baseId}-${counter}`)) {
    counter += 1;
  }
  return `${baseId}-${counter}`;
}

function reorderByBeforeId<T extends { id: string }>(items: T[], item: T, beforeItemId: string | null): T[] {
  const nextItems = items.filter((candidate) => candidate.id !== item.id);
  const insertIndex = beforeItemId === null
    ? nextItems.length
    : nextItems.findIndex((candidate) => candidate.id === beforeItemId);

  nextItems.splice(insertIndex, 0, item);
  return nextItems;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'team';
}
