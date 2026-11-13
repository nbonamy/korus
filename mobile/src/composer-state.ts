import { computed, reactive, shallowRef } from 'vue';
import type { Agent, ProviderModelOption } from '@workspace/core/contracts';
import { companionAgents } from '@workspace/core/companion-protocol';
import type { CompanionSession, CompanionWorkspace } from './companion-port';
import { applyComposerChoice, resolveComposerSettings, type ComposerChange, type ComposerChoice } from './composer-settings';

/**
 * The model menu and the permission picker of the selected chat. Choices are remembered here at once and saved on
 * the laptop; models and choices belong to a chat under one engine, because another engine has its own.
 */
export function createComposerState(deps: {
  session(): CompanionSession | null;
  agent(): Agent | null;
  agentId(): string;
  workspace(): CompanionWorkspace;
  /** Takes in a workspace the laptop just reported, and reselects the chat if its session changed. */
  applyWorkspace(next: CompanionWorkspace): void;
}) {
  const catalog = shallowRef<Record<string, ProviderModelOption[]>>({});
  /** Model lists being asked for, by chat and engine: the model menu shows it is loading instead of staying empty. */
  const asking = shallowRef<ReadonlySet<string>>(new Set());
  const choices = reactive<Record<string, ComposerChoice>>({});
  const permissionChoices = reactive<Record<string, string>>({});
  const permissionRequests = new Map<string, symbol>();

  const modelKey = (id: string, provider: string | undefined) => `${id}:${provider ?? ''}`;
  const currentKey = () => modelKey(deps.agentId(), deps.agent()?.provider);
  const models = computed(() => catalog.value[currentKey()] ?? []);
  const composerSettings = computed(() => { const agent = deps.agent(); return agent ? resolveComposerSettings(agent, models.value, choices[currentKey()]) : null; });
  const modelFavorites = computed(() => deps.workspace().modelFavorites ?? []);
  /** The permission the agent runs with now: the phone's latest choice, else what the laptop reports. */
  const permission = computed(() => {
    const current = deps.agent(); if (!current) return null;
    return permissionChoices[current.id] ?? current.providerDefaults?.permission ?? null;
  });

  async function loadModels(id: string, capturedSession: CompanionSession) {
    const backendOf = () => companionAgents(deps.workspace()).find((candidate) => candidate.id === id)?.provider;
    const requested = backendOf(); const key = modelKey(id, requested);
    if (!capturedSession.listModels || catalog.value[key] || asking.value.has(key)) return;
    asking.value = new Set(asking.value).add(key);
    try {
      const list = await capturedSession.listModels(id);
      // A list asked for under another engine is not this engine's list.
      if (deps.session() === capturedSession && backendOf() === requested) catalog.value = { ...catalog.value, [key]: list };
    } catch { /* Without a catalog the model menu simply stays hidden. */ }
    finally { const next = new Set(asking.value); next.delete(key); asking.value = next; }
  }
  /** A list fetched alongside an engine switch: it lands with the engine, so the menu never shows the old one's models. */
  function seedModels(id: string, provider: string, list: ProviderModelOption[]) { catalog.value = { ...catalog.value, [modelKey(id, provider)]: list }; }
  const modelsLoading = computed(() => asking.value.has(currentKey()));

  function currentChoice(): ComposerChoice {
    const settings = composerSettings.value;
    return settings ? { model: settings.model?.model ?? null, reasoningEffort: settings.reasoningEffort, serviceTier: settings.serviceTier, planMode: settings.planMode } : {};
  }

  /** One change from the model menu: remembered here, and saved on the laptop like the desktop does. */
  function updateSettings(change: ComposerChange) {
    const id = deps.agentId(); const active = deps.session();
    if (!id || !active || !deps.agent()) return;
    const key = currentKey();
    const { choice, save } = applyComposerChoice(deps.agent()!.provider, models.value, choices[key] ?? currentChoice(), change);
    choices[key] = choice;
    if (save && active.selectModel) void active.selectModel(id, save).catch(() => {});
  }

  /** Optimistic only until the owning laptop answers; subsequent policy updates stay authoritative. */
  async function setPermission(permission: string) {
    const id = deps.agentId(); const active = deps.session();
    if (!id || !active) return;
    const token = Symbol();
    permissionRequests.set(id, token);
    permissionChoices[id] = permission;
    try {
      await active.setPermission?.(id, permission);
      if (active !== deps.session()) return;
      const next = await active.getWorkspace();
      if (active === deps.session()) deps.applyWorkspace(next);
    } catch { /* Revert to the latest authoritative policy on rejection or transport failure. */ }
    finally {
      if (permissionRequests.get(id) === token) { permissionRequests.delete(id); delete permissionChoices[id]; }
    }
  }

  return {
    models, composerSettings, modelFavorites, permission, loadModels, seedModels, modelsLoading, updateSettings, setPermission,
    /** The laptop reported this chat's policy itself: a pending local choice no longer applies. */
    forgetPermission(id: string) { permissionRequests.delete(id); delete permissionChoices[id]; },
    /** The connection ended: no pending local choice survives it. */
    forgetAllPermissions() { permissionRequests.clear(); for (const id of Object.keys(permissionChoices)) delete permissionChoices[id]; },
    /** Another laptop: its model lists are not these. */
    forgetModels() { catalog.value = {}; },
  };
}
