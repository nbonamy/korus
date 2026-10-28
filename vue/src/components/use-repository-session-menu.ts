import { ref, type Ref } from 'vue';
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
): RepositorySessionMenuState {
  const visibleGroupId = ref<string | null>(null);
  const defaultBranches = ref<Record<string, SourceBranch | null>>({});
  const loading = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | null>>({});

  async function setVisible(group: WorkspaceSidebarGroup, visible: boolean): Promise<void> {
    if (group.kind !== 'repository' || !group.repositoryRoot) return;
    visibleGroupId.value = visible ? group.id : null;
    if (!visible || defaultBranches.value[group.id] !== undefined || loading.value[group.id]) return;

    loading.value = { ...loading.value, [group.id]: true };
    errors.value = { ...errors.value, [group.id]: null };
    try {
      const branches = await branchLoader()?.({
        agentId: group.repositoryAgentId ?? group.sessions[0]!.agentId,
        repositoryRoot: group.repositoryRoot,
        ...(group.remoteConnectionId ? { remoteConnectionId: group.remoteConnectionId } : {}),
      }) ?? [];
      defaultBranches.value = {
        ...defaultBranches.value,
        [group.id]: branches.find((branch) => branch.isDefault) ?? null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message.trim() : '';
      errors.value = {
        ...errors.value,
        [group.id]: detail
          ? translate('errors.branchesLoadWithDetail', { detail })
          : translate('errors.branchesLoad'),
      };
    } finally {
      loading.value = { ...loading.value, [group.id]: false };
    }
  }

  return { defaultBranches, errors, loading, visibleGroupId, setVisible };
}
