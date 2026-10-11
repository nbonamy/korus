import type { AppSnapshot,UpdateSettingsInput } from '@workspace/core/contracts';
import { projectClientSnapshot,splitSettingsInput,type ClientPreferences } from '@workspace/core/client-preferences';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { selectAgent,reorderAgentInTeam,reorderRepositoryInTeam,updateAgentOpenInApplication } from '@workspace/core/agent-manager';
import { selectTeam,reorderTeamInSnapshot } from '@workspace/core/team-manager';
import { updateSettingsInSnapshot } from '@workspace/core/settings';

const methods: Set<string> = new Set([
  backendMethods.clientNavigationSelectAgent, backendMethods.clientNavigationSelectTeam,
  backendMethods.clientAgentOrderUpdate, backendMethods.clientTeamOrderUpdate,
  backendMethods.clientRepositoryOrderUpdate, backendMethods.clientAgentExternalApplicationUpdate,
  backendMethods.clientPreferencesUpdate,
]);

/** Client presentation preferences never mutate the owning runtime or a remote host. */
export class ClientPreferencesService {
  private readonly pending = new Map<string, Promise<AppSnapshot>>();
  constructor(private readonly options: {
    snapshot: () => Promise<AppSnapshot>;
    save: (clientId: string, preferences: ClientPreferences) => Promise<void>;
  }) {}

  supports(method: string): boolean { return methods.has(method); }

  update(clientId: string, method: string, params: Record<string, unknown>): Promise<AppSnapshot> {
    const previous = this.pending.get(clientId);
    const next = (previous ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.applyUpdate(clientId, method, params));
    this.pending.set(clientId, next);
    void next.finally(() => { if (this.pending.get(clientId) === next) this.pending.delete(clientId); }).catch(() => undefined);
    return next;
  }

  private async applyUpdate(clientId: string, method: string, params: Record<string, unknown>): Promise<AppSnapshot> {
    const original = await this.options.snapshot();
    const snapshot = structuredClone(projectClientSnapshot(original, clientId));
    const preferences = structuredClone(original.clientPreferences?.[clientId] ?? {});
    const input = params.input as Record<string, unknown> | undefined;
    const string = (value: unknown): string => {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Expected a nonempty identifier.');
      return value;
    };
    if (method === backendMethods.clientNavigationSelectAgent) {
      const id = string(params.agentId);
      if (!snapshot.agents.some((agent) => agent.id === id)) throw new Error(`Agent not found: ${id}`);
      selectAgent(snapshot, id);
    } else if (method === backendMethods.clientNavigationSelectTeam) {
      const id = string(params.teamId);
      if (!snapshot.teams.some((team) => team.id === id)) throw new Error(`Team not found: ${id}`);
      selectTeam(snapshot, id);
    } else if (method === backendMethods.clientAgentOrderUpdate) {
      if (!reorderAgentInTeam(snapshot, string(input?.teamId), string(input?.agentId), input?.beforeAgentId == null ? null : string(input.beforeAgentId))) throw new Error('Agent reorder target not found.');
    } else if (method === backendMethods.clientRepositoryOrderUpdate) {
      if (!reorderRepositoryInTeam(snapshot, string(input?.teamId), string(input?.repositoryRoot), input?.beforeRepositoryRoot == null ? null : string(input.beforeRepositoryRoot))) throw new Error('Repository reorder target not found.');
    } else if (method === backendMethods.clientTeamOrderUpdate) {
      if (!reorderTeamInSnapshot(snapshot, string(input?.teamId), input?.beforeTeamId == null ? null : string(input.beforeTeamId))) throw new Error('Team reorder target not found.');
    } else if (method === backendMethods.clientAgentExternalApplicationUpdate) {
      const application = string(params.application);
      if (!['vscode', 'finder', 'terminal', 'iterm2', 'ghostty', 'xcode', 'android-studio', 'jetbrains'].includes(application)) throw new Error('Invalid external application.');
      if (!updateAgentOpenInApplication(snapshot, string(params.agentId), application as NonNullable<import('@workspace/core/contracts').Agent['openInApplication']>)) throw new Error('Agent not found.');
    } else {
      const split = splitSettingsInput((input ?? {}) as UpdateSettingsInput);
      if (Object.keys(split.policy).length) throw new Error('Backend policies must be updated through settings/update.');
      updateSettingsInSnapshot(snapshot, split.preferences);
      preferences.general = { ...preferences.general, ...split.preferences.general };
      if (split.preferences.general?.browserBookmarks !== undefined) {
        preferences.general.browserBookmarks = snapshot.general.browserBookmarks;
      }
      preferences.theme = { ...preferences.theme, ...split.preferences.theme };
    }
    preferences.activeAgentId = snapshot.activeAgentId;
    preferences.activeTeamId = snapshot.activeTeamId;
    preferences.teamOrder = snapshot.teams.map((team) => team.id);
    preferences.agentOrderByTeam = Object.fromEntries(snapshot.teams.map((team) => [team.id, team.agentIds]));
    preferences.activeAgentByTeam = Object.fromEntries(snapshot.teams.flatMap((team) => team.activeAgentId ? [[team.id, team.activeAgentId]] : []));
    preferences.externalApplications = Object.fromEntries(snapshot.agents.flatMap((agent) => agent.openInApplication ? [[agent.id, agent.openInApplication]] : []));
    await this.options.save(clientId, preferences);
    snapshot.clientPreferences = { ...original.clientPreferences, [clientId]: preferences };
    return snapshot;
  }
}
