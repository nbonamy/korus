import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { isAppSnapshotGetResult, type AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import type { Agent, AppSnapshot, RemoteConnection, RemoteTeamLink, Team } from '@workspace/core/contracts';
import { workItemAssignmentKey, type WorkItemAssignmentSource } from '@workspace/core/work-assignments';
import type { RemoteDaemonClientManager } from './remote-daemon-client';

export type RemoteTeamPointer = {
  connectionId: string;
  localTeamId: string;
  remoteTeamId: string;
};

export type RemoteAgentOwner = RemoteTeamPointer & { agent: Agent };

/** Keeps the last known remote agents across restarts so their projects stay listed while a host is down. */
export type RemoteSnapshotCache = {
  load: () => Map<string, AppSnapshot>;
  save: (connectionId: string, snapshot: AppSnapshot | null) => void;
  flush?: () => Promise<void>;
};

export type RemoteTeamServiceOptions = {
  clients: RemoteDaemonClientManager;
  getSnapshot: () => AppSnapshot;
  cache?: RemoteSnapshotCache;
  onConnectionFailed?: (connectionId: string, error: Error) => void;
  onForwardedEvent: (connectionId: string, event: AppBackendEvent) => void;
  onProjectedSnapshotChanged: () => void;
};

/** Owns remote daemon snapshot caching, team projection, and remote ownership lookup. */
export class RemoteTeamService {
  private readonly snapshots = new Map<string, AppSnapshot>();
  /** Hosts whose snapshot comes from the cache and has not been confirmed by the host yet. */
  private readonly stale = new Set<string>();
  private readonly refreshing = new Set<string>();
  private readonly creatingTeams = new Map<string, Promise<RemoteTeamPointer>>();

  constructor(private readonly options: RemoteTeamServiceOptions) {
    for (const [connectionId, snapshot] of options.cache?.load() ?? []) {
      this.snapshots.set(connectionId, withoutRunningWork(snapshot));
      this.stale.add(connectionId);
    }
  }

  connectionIdForAgent(agent: Pick<Agent, 'remoteConnectionId'>): string | null {
    return agent.remoteConnectionId?.trim() || null;
  }

  linksForTeam(team: Team | null): RemoteTeamLink[] {
    return team?.remoteLinks ?? [];
  }

  pointerForTeamConnection(team: Team | null, connectionId: string): RemoteTeamPointer | null {
    const link = this.linksForTeam(team).find((candidate) => candidate.connectionId === connectionId);
    return team && link ? { connectionId, localTeamId: team.id, remoteTeamId: link.remoteTeamId } : null;
  }

  /**
   * Resolves where an agent creation runs. A local team keeps one hidden team per host on the remote
   * daemon; the first remote agent for a host creates it.
   */
  async pointerForAgentInput(input: { teamId?: string; remoteConnectionId?: string }): Promise<RemoteTeamPointer | null> {
    const snapshot = this.options.getSnapshot();
    if (!input.teamId) throw new Error('A target team is required before resolving its location.');
    const team = snapshot.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) throw new Error(`Team not found: ${input.teamId}`);
    const connectionId = input.remoteConnectionId?.trim() ?? '';
    if (!connectionId) return null;
    this.validateConnection(connectionId);
    const existing = this.pointerForTeamConnection(team, connectionId);
    if (existing) return existing;
    const key = JSON.stringify([team.id, connectionId]);
    const pending = this.creatingTeams.get(key);
    if (pending) return pending;
    const creation = this.createRemoteTeam(connectionId, team).then(remoteTeam => {
      team.remoteLinks = [...(team.remoteLinks ?? []), { connectionId, remoteTeamId: remoteTeam.id }];
      return { connectionId, localTeamId: team.id, remoteTeamId: remoteTeam.id };
    }).finally(() => this.creatingTeams.delete(key));
    this.creatingTeams.set(key, creation);
    return creation;
  }

  knownSnapshot(connectionId: string): AppSnapshot | undefined {
    return this.snapshots.get(connectionId);
  }

  rememberSnapshot(connectionId: string, snapshot: AppSnapshot): void {
    this.snapshots.set(connectionId, snapshot);
    this.stale.delete(connectionId);
    this.options.cache?.save(connectionId, this.cacheable(connectionId, snapshot));
    const connection = this.options.getSnapshot().remoteConnections.connections.find(item => item.id === connectionId);
    if (connection) connection.providerConnections = snapshot.providerConnections;
  }

  adoptCreatedAgentSnapshot(pointer: RemoteTeamPointer, remoteSnapshot: AppSnapshot): void {
    this.rememberSnapshot(pointer.connectionId, remoteSnapshot);
  }

  async request<Result = unknown>(connectionId: string, method: string, params?: unknown): Promise<Result> {
    return this.remoteRequest(connectionId, method, params);
  }

  private async remoteRequest<Result = unknown>(connectionId: string, method: string, params?: unknown): Promise<Result> {
    return this.options.clients.request<Result>(this.connection(connectionId), method, { ...(params && typeof params === 'object' ? params : {}), _clientId: 'remote-controller' }, (event) => {
      this.applyEvent(connectionId, event);
    });
  }

  async snapshot(connectionId: string): Promise<AppSnapshot> {
    const result = await this.remoteRequest(connectionId, backendMethods.snapshotGet);
    if (!isAppSnapshotGetResult(result)) throw new Error('Remote snapshot is invalid.');
    this.rememberSnapshot(connectionId, result.snapshot);
    return result.snapshot;
  }

  private async createRemoteTeam(connectionId: string, localTeam: Team): Promise<Team> {
    const remoteSnapshot = await this.request<AppSnapshot>(connectionId, backendMethods.teamCreate, {
      input: { name: localTeam.name, color: localTeam.color ?? '' },
    });
    this.rememberSnapshot(connectionId, remoteSnapshot);
    const remoteTeam = remoteSnapshot.teams.find((team) => team.id === remoteSnapshot.activeTeamId)
      ?? remoteSnapshot.teams[remoteSnapshot.teams.length - 1];
    if (!remoteTeam) throw new Error('Remote team was not created.');
    return remoteTeam;
  }

  /** Removes the hidden remote team of a host (and the agents in it) when a local team goes away. */
  async deleteRemoteTeams(team: Team, persist: () => Promise<unknown>): Promise<void> {
    for (const link of [...this.linksForTeam(team)]) {
      const remoteSnapshot = await this.request<AppSnapshot>(link.connectionId, backendMethods.teamDelete, { teamId: link.remoteTeamId, missingOk: true });
      this.rememberSnapshot(link.connectionId, remoteSnapshot);
      team.remoteLinks = team.remoteLinks?.filter(candidate => candidate !== link);
      if (!team.remoteLinks?.length) delete team.remoteLinks;
      await persist();
    }
  }

  /** Drops links to a host that is no longer configured; its agents disappear from the projection. */
  forgetConnection(connectionId: string): void {
    for (const team of this.options.getSnapshot().teams) {
      if (team.remoteLinks?.some((link) => link.connectionId === connectionId)) {
        team.remoteLinks = team.remoteLinks.filter((link) => link.connectionId !== connectionId);
        if (!team.remoteLinks.length) delete team.remoteLinks;
      }
    }
    this.snapshots.delete(connectionId);
    this.stale.delete(connectionId);
    this.options.cache?.save(connectionId, null);
  }

  async agentOwner(agentId: string): Promise<RemoteAgentOwner | null> {
    for (const pointer of this.pointers()) {
      const cachedAgent = remoteTeamAgent(this.snapshots.get(pointer.connectionId), pointer.remoteTeamId, agentId);
      if (cachedAgent) return { ...pointer, agent: cachedAgent };
      const agent = remoteTeamAgent(await this.snapshot(pointer.connectionId), pointer.remoteTeamId, agentId);
      if (agent) return { ...pointer, agent };
    }
    return null;
  }

  async workItemAssignmentOwner(item: WorkItemAssignmentSource): Promise<RemoteTeamPointer | null> {
    const snapshot = this.options.getSnapshot();
    const assignmentKey = workItemAssignmentKey(item);
    const teams = [...snapshot.teams].sort((left, right) => (
      left.id === snapshot.activeTeamId ? -1 : right.id === snapshot.activeTeamId ? 1 : 0
    ));
    for (const pointer of this.pointers(teams)) {
      const cached = this.snapshots.get(pointer.connectionId);
      const cachedAssignment = cached?.workBacklog.assignments[assignmentKey];
      if (cachedAssignment && remoteTeamAgent(cached, pointer.remoteTeamId, cachedAssignment.agentId)) return pointer;
      const remoteSnapshot = cached ?? await this.snapshot(pointer.connectionId);
      const assignment = remoteSnapshot.workBacklog.assignments[assignmentKey];
      if (assignment && remoteTeamAgent(remoteSnapshot, pointer.remoteTeamId, assignment.agentId)) return pointer;
    }
    return null;
  }

  private pointers(teams: Team[] = this.options.getSnapshot().teams): RemoteTeamPointer[] {
    return teams.flatMap((team) => this.linksForTeam(team).map((link) => ({ connectionId: link.connectionId, localTeamId: team.id, remoteTeamId: link.remoteTeamId })));
  }

  validateConnection(connectionId: string | undefined): void {
    const normalized = connectionId?.trim() ?? '';
    if (!normalized) return;
    if (!this.options.getSnapshot().remoteConnections.connections.some((connection) => connection.id === normalized)) {
      throw new Error(`Remote connection not found: ${normalized}`);
    }
  }

  async clientSnapshot(): Promise<AppSnapshot> {
    for (const pointer of this.pointers()) {
      if (this.stale.has(pointer.connectionId)) {
        this.refreshInBackground(pointer.connectionId);
        continue;
      }
      if (this.snapshots.has(pointer.connectionId)) continue;
      try {
        await this.snapshot(pointer.connectionId);
      } catch {
        // Unknown remotes are projected as empty without losing their local link.
      }
    }
    return this.clientSnapshotFromKnownRemotes();
  }

  /** Serves the cached agents right away and learns in the background whether the host answers. */
  private refreshInBackground(connectionId: string): void {
    if (this.refreshing.has(connectionId)) return;
    if (!this.options.getSnapshot().remoteConnections.connections.some(connection => connection.id === connectionId && connection.status === 'ready')) return;
    this.refreshing.add(connectionId);
    void this.snapshot(connectionId)
      .then(() => this.options.onProjectedSnapshotChanged())
      .catch((error: unknown) => {
        this.reportConnectionFailure(connectionId, error);
      })
      .finally(() => this.refreshing.delete(connectionId));
  }

  private reportConnectionFailure(connectionId: string, error: unknown): void {
    if (this.options.getSnapshot().remoteConnections.connections.some(connection => connection.id === connectionId && connection.status === 'ready')) {
      this.options.onConnectionFailed?.(connectionId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Only the linked remote teams are kept: the cache serves the projection, not the whole host. */
  private cacheable(connectionId: string, snapshot: AppSnapshot): AppSnapshot {
    const teamIds = new Set(this.pointers().filter(pointer => pointer.connectionId === connectionId).map(pointer => pointer.remoteTeamId));
    const teams = snapshot.teams.filter(team => teamIds.has(team.id));
    const agentIds = new Set(teams.flatMap(team => team.agentIds));
    return {
      ...createEmptySnapshot(),
      teams,
      agents: snapshot.agents.filter(agent => agentIds.has(agent.id)),
      providerConnections: snapshot.providerConnections,
    };
  }

  clientSnapshotFromKnownRemotes(): AppSnapshot {
    const source = this.options.getSnapshot();
    const snapshot = cloneAppSnapshot(source);
    for (const team of snapshot.teams) {
      for (const link of this.linksForTeam(team)) {
        const remoteSnapshot = this.snapshots.get(link.connectionId);
        if (remoteSnapshot) projectRemoteTeam(snapshot, team, remoteSnapshot, link);
      }
    }
    applyRemoteActiveAgent(snapshot);
    return snapshot;
  }

  private connection(connectionId: string): RemoteConnection {
    const connection = this.options.getSnapshot().remoteConnections.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) throw new Error(`Remote connection not found: ${connectionId}`);
    if (connection.status !== 'ready' || !connection.transport) {
      throw new Error(`Remote connection is not ready: ${connection.name}`);
    }
    return connection;
  }

  private applyEvent(connectionId: string, event: AppBackendEvent): void {
    const decodedSnapshot = decodeSnapshotFromRemoteEvent(event);
    if (decodedSnapshot) {
      this.rememberSnapshot(connectionId, decodedSnapshot.value);
    } else if (event.type !== 'snapshot.updated') {
      const remoteSnapshot = this.snapshots.get(connectionId);
      if (remoteSnapshot) applyMainEventToSnapshot(remoteSnapshot, event);
    }
    if (event.type === 'snapshot.updated') {
      this.options.onProjectedSnapshotChanged();
      return;
    }
    if (this.shouldForwardEvent(connectionId, event)) this.options.onForwardedEvent(connectionId, event);
  }

  private shouldForwardEvent(connectionId: string, event: AppBackendEvent): boolean {
    const agentId = event.agentId;
    if (!agentId) return this.hasTeamPointer(connectionId);
    const remoteSnapshot = this.snapshots.get(connectionId);
    if (!remoteSnapshot) return false;
    return this.pointers().some((pointer) => pointer.connectionId === connectionId
      && Boolean(remoteTeamAgent(remoteSnapshot, pointer.remoteTeamId, agentId)));
  }

  private hasTeamPointer(connectionId: string): boolean {
    return this.pointers().some((pointer) => pointer.connectionId === connectionId);
  }
}

function withoutRunningWork(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map(agent => agent.status.type === 'working' || agent.status.type === 'awaitingInput' ? { ...agent, status: { type: 'idle' } } : agent),
  };
}

function decodeSnapshotFromRemoteEvent(event: AppBackendEvent) {
  const sideChannelSnapshot = decodeAppSnapshot(event.snapshot);
  if (sideChannelSnapshot) return sideChannelSnapshot;
  if (event.type !== 'snapshot.updated') return null;
  return decodeAppSnapshot(event.payload);
}

function cloneAppSnapshot(snapshot: AppSnapshot): AppSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AppSnapshot;
}

function projectRemoteTeam(target: AppSnapshot, localTeam: Team, remoteSnapshot: AppSnapshot, link: RemoteTeamLink): void {
  const remoteTeam = remoteSnapshot.teams.find((team) => team.id === link.remoteTeamId);
  if (!remoteTeam) return;
  const remoteAgentIds = new Set(remoteTeam.agentIds);
  const remoteAgents = remoteSnapshot.agents
    .filter((agent) => remoteAgentIds.has(agent.id))
    .map((agent) => ({ ...agent, teamId: localTeam.id, remoteConnectionId: link.connectionId }));
  localTeam.agentIds = [...localTeam.agentIds.filter((id) => !remoteAgents.some((agent) => agent.id === id)), ...remoteAgents.map((agent) => agent.id)];
  if (!localTeam.activeAgentId || !localTeam.agentIds.includes(localTeam.activeAgentId)) localTeam.activeAgentId = localTeam.agentIds[0];

  const projectedAgentIds = new Set(remoteAgents.map((agent) => agent.id));
  target.agents = [...target.agents.filter((agent) => !projectedAgentIds.has(agent.id)), ...remoteAgents];
  target.agentGitStatuses = {
    ...target.agentGitStatuses,
    ...Object.fromEntries(Object.entries(remoteSnapshot.agentGitStatuses).filter(([agentId]) => projectedAgentIds.has(agentId))),
  };
  target.agentRequests = {
    ...Object.fromEntries(Object.entries(target.agentRequests ?? {}).filter(([agentId]) => !projectedAgentIds.has(agentId))),
    ...Object.fromEntries(Object.entries(remoteSnapshot.agentRequests ?? {}).filter(([agentId]) => projectedAgentIds.has(agentId))),
  };
  target.queuedPrompts = [
    ...(target.queuedPrompts ?? []).filter(prompt => !projectedAgentIds.has(prompt.agentId)),
    ...(remoteSnapshot.queuedPrompts ?? []).filter(prompt => projectedAgentIds.has(prompt.agentId)),
  ];
  target.backendApprovals = {
    ...Object.fromEntries(Object.entries(target.backendApprovals).filter(([agentId]) => !projectedAgentIds.has(agentId))),
    ...Object.fromEntries(Object.entries(remoteSnapshot.backendApprovals).filter(([agentId]) => projectedAgentIds.has(agentId))),
  };
  target.turnGitDiffs = {
    ...Object.fromEntries(Object.entries(target.turnGitDiffs).filter(([, diff]) => !projectedAgentIds.has(diff.agentId))),
    ...Object.fromEntries(Object.entries(remoteSnapshot.turnGitDiffs).filter(([, diff]) => projectedAgentIds.has(diff.agentId))),
  };
  target.subagentTrees = {
    ...Object.fromEntries(Object.entries(target.subagentTrees).filter(([agentId]) => !projectedAgentIds.has(agentId))),
    ...Object.fromEntries(Object.entries(remoteSnapshot.subagentTrees).filter(([agentId]) => projectedAgentIds.has(agentId))),
  };
  target.workBacklog.assignments = {
    ...Object.fromEntries(Object.entries(target.workBacklog.assignments).filter(([, assignment]) => !projectedAgentIds.has(assignment.agentId))),
    ...Object.fromEntries(Object.entries(remoteSnapshot.workBacklog.assignments).filter(([, assignment]) => projectedAgentIds.has(assignment.agentId))),
  };
}

function applyRemoteActiveAgent(snapshot: AppSnapshot): void {
  if (snapshot.activeAgentId && snapshot.agents.some((agent) => agent.id === snapshot.activeAgentId)) return;
  const activeTeam = snapshot.teams.find((team) => team.id === snapshot.activeTeamId) ?? null;
  if (!activeTeam?.remoteLinks?.length) return;
  snapshot.activeAgentId = activeTeam.activeAgentId && activeTeam.agentIds.includes(activeTeam.activeAgentId)
    ? activeTeam.activeAgentId
    : activeTeam.agentIds[0] ?? null;
}

function remoteTeamAgent(snapshot: AppSnapshot | undefined, remoteTeamId: string, agentId: string): Agent | null {
  const remoteTeam = snapshot?.teams.find((team) => team.id === remoteTeamId);
  if (!remoteTeam?.agentIds.includes(agentId)) return null;
  return snapshot?.agents.find((agent) => agent.id === agentId) ?? null;
}
