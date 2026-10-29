import { computed, ref, watch } from 'vue';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import type { CloneSourceRepositoryInput, ExecutionSelection, RemoteConnection, SourceRepository } from '@workspace/core/contracts';

export type RemoteTargetRequest = {
  action: 'main' | 'new-worktree';
  repositoryName: string;
  repositoryKey: string;
  originUrl?: string;
};

/** Whether a machine already has the repository, matched by origin identity rather than by path. */
export type RemoteCheckout =
  | { state: 'checking' }
  | { state: 'cloned'; path: string }
  | { state: 'missing'; cloneTo?: string }
  | { state: 'noOrigin' }
  | { state: 'unreachable'; message: string };

const lastHostKey = (repositoryKey: string) => `remoteTarget:lastHost:${repositoryKey}`;

/** The "where" step of opening a repository on a remote machine: check the chosen machine, clone when needed, then continue. */
export function useRemoteTarget(options: {
  connections: () => RemoteConnection[];
  listSourceRepositories: (remoteConnectionId: string) => Promise<SourceRepository[]>;
  cloneRepository: (input: CloneSourceRepositoryInput) => Promise<SourceRepository>;
  openMain: (path: string, remoteConnectionId: string, request: RemoteTargetRequest, selection?: ExecutionSelection) => Promise<void>;
  openWorktree: (path: string, remoteConnectionId: string, request: RemoteTargetRequest) => Promise<void>;
  errorMessage?: (error: unknown) => string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}) {
  const visible = ref(false);
  const request = ref<RemoteTargetRequest | null>(null);
  const checkouts = ref<Record<string, RemoteCheckout>>({});
  const selectedId = ref('');
  const selection = ref<ExecutionSelection>();
  const busy = ref(false);
  const error = ref<string | null>(null);
  let epoch = 0;

  const storage = () => options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const message = (cause: unknown) => options.errorMessage?.(cause) ?? (cause instanceof Error ? cause.message : String(cause));
  const readyConnections = computed(() => options.connections().filter((connection) => connection.status === 'ready'));
  const selectedCheckout = computed<RemoteCheckout | undefined>(() => checkouts.value[selectedId.value]);
  const canConfirm = computed(() => {
    const checkout = selectedCheckout.value;
    return !busy.value && (checkout?.state === 'cloned' || checkout?.state === 'missing');
  });

  async function open(next: RemoteTargetRequest): Promise<void> {
    const mine = ++epoch;
    request.value = next;
    selection.value = undefined;
    visible.value = true;
    busy.value = false;
    error.value = null;
    const ready = readyConnections.value;
    const remembered = storage()?.getItem(lastHostKey(next.repositoryKey)) ?? '';
    selectedId.value = ready.find((connection) => connection.id === remembered)?.id ?? ready[0]?.id ?? '';
    identity = next.originUrl ? canonicalGitRemoteIdentity(next.originUrl) : undefined;
    // A machine is only asked when it is chosen: the first one now, the others on selection.
    checkouts.value = identity ? {} : Object.fromEntries(ready.map((connection) => [connection.id, { state: 'noOrigin' } as RemoteCheckout]));
    if (selectedId.value) await check(selectedId.value, mine);
  }

  let identity: string | undefined;

  async function check(connectionId: string, mine = epoch): Promise<void> {
    const connection = readyConnections.value.find((candidate) => candidate.id === connectionId);
    if (!connection || !identity || checkouts.value[connectionId]) return;
    checkouts.value = { ...checkouts.value, [connectionId]: { state: 'checking' } };
    let result: RemoteCheckout;
    try {
      const repositories = await options.listSourceRepositories(connectionId);
      const match = repositories.find((repository) => repository.remoteIdentity === identity);
      result = match ? { state: 'cloned', path: match.path } : { state: 'missing', ...(connection.sourceFolderPath ? { cloneTo: connection.sourceFolderPath } : {}) };
    } catch (cause) {
      result = { state: 'unreachable', message: message(cause) };
    }
    if (mine === epoch) checkouts.value = { ...checkouts.value, [connectionId]: result };
  }

  watch(selectedId, (connectionId) => { if (visible.value && connectionId) void check(connectionId); });

  function close(): void {
    ++epoch;
    visible.value = false;
    request.value = null;
    busy.value = false;
    error.value = null;
  }

  /** Clones first when the machine lacks the repository; a clone that cannot authenticate stops everything. */
  async function confirm(): Promise<void> {
    const current = request.value;
    const connectionId = selectedId.value;
    const checkout = selectedCheckout.value;
    if (!current || !connectionId || !canConfirm.value || !checkout) return;
    const mine = epoch;
    busy.value = true;
    error.value = null;
    try {
      let path = checkout.state === 'cloned' ? checkout.path : '';
      if (checkout.state === 'missing') {
        const cloned = await options.cloneRepository({ url: current.originUrl!, remoteConnectionId: connectionId, reuseExisting: true });
        path = cloned.path;
      }
      if (mine !== epoch) return;
      storage()?.setItem(lastHostKey(current.repositoryKey), connectionId);
      close();
      if (current.action === 'main') await options.openMain(path, connectionId, current, selection.value ? { ...selection.value } : undefined);
      else await options.openWorktree(path, connectionId, current);
    } catch (cause) {
      if (mine === epoch) error.value = message(cause);
    } finally {
      if (mine === epoch) busy.value = false;
    }
  }

  return { busy, canConfirm, checkouts, close, confirm, error, open, readyConnections, request, selectedId, selection, visible };
}
