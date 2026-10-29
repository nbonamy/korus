import { ref, shallowRef, watch, type Ref } from 'vue';
import type { SourceBranch } from '@workspace/core/contracts';
import type { WorkspaceSidebarGroup } from '@workspace/core/workspace-sidebar';

type RepositoryBranchLoader = (input: {
  agentId: string;
  repositoryRoot: string;
  remoteConnectionId?: string;
}) => Promise<SourceBranch[]>;

export type RepositorySessionMenuState = {
  defaultBranches: Ref<Record<string, SourceBranch | null>>;
  errors: Ref<Record<string, string | null>>;
  loading: Ref<Record<string, boolean>>;
  visibleGroupId: Ref<string | null>;
  setVisible: (group: WorkspaceSidebarGroup, visible: boolean) => Promise<void>;
};

export function useRepositorySessionMenu(
  branchLoader: () => RepositoryBranchLoader | undefined,
  translate: (key: string, params?: Record<string, string>) => string,
  groups?: () => WorkspaceSidebarGroup[],
): RepositorySessionMenuState {
  const visibleGroupId = ref<string | null>(null);
  const defaultBranches = ref<Record<string, SourceBranch | null>>({});
  const loading = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | null>>({});

  const targets = new Map<string, string>();
  const requests = new Map<string, symbol>();
  const current = shallowRef<WorkspaceSidebarGroup>();
  const targetKey = (group: WorkspaceSidebarGroup) => JSON.stringify([group.remoteConnectionId ?? null, group.repositoryRoot]);
  watch(() => {
    const group = groups?.().find(group => group.id === visibleGroupId.value) ?? current.value;
    return group && visibleGroupId.value === group.id ? [group, targetKey(group)] as const : undefined;
  }, value => {
    if (value && targets.get(value[0].id) !== value[1]) void setVisible(value[0], true);
  });

  async function setVisible(group: WorkspaceSidebarGroup, visible: boolean): Promise<void> {
    if (group.kind !== 'repository' || !group.repositoryRoot) return;
    const key = targetKey(group);
    if (targets.get(group.id) !== key) {
      targets.set(group.id, key);
      requests.delete(group.id);
      delete defaultBranches.value[group.id];
      errors.value[group.id] = null;
      loading.value[group.id] = false;
    }
    current.value = group;
    visibleGroupId.value = visible ? group.id : null;
    if (!visible || defaultBranches.value[group.id] !== undefined || loading.value[group.id]) return;

    const request = Symbol();
    requests.set(group.id, request);
    const currentRequest = () => requests.get(group.id) === request && targets.get(group.id) === key;
    loading.value = { ...loading.value, [group.id]: true };
    errors.value = { ...errors.value, [group.id]: null };
    try {
      const branches = await branchLoader()?.({
        agentId: group.repositoryAgentId ?? group.sessions[0]!.agentId,
        repositoryRoot: group.repositoryRoot,
        ...(group.remoteConnectionId ? { remoteConnectionId: group.remoteConnectionId } : {}),
      }) ?? [];
      if (!currentRequest()) return;
      defaultBranches.value = {
        ...defaultBranches.value,
        [group.id]: branches.find((branch) => branch.isDefault) ?? null,
      };
    } catch (error) {
      if (!currentRequest()) return;
      const detail = error instanceof Error ? error.message.trim() : '';
      errors.value = {
        ...errors.value,
        [group.id]: detail
          ? translate('errors.branchesLoadWithDetail', { detail })
          : translate('errors.branchesLoad'),
      };
    } finally {
      if (currentRequest()) loading.value = { ...loading.value, [group.id]: false };
    }
  }

  return { defaultBranches, errors, loading, visibleGroupId, setVisible };
}
