import { computed, ref, shallowRef, watch } from 'vue';
import type { Agent, AgentGitDiff, AgentGitDiffSummary, AgentGitDiffTarget } from '@workspace/core/contracts';
import type { CompanionGitStatus } from '@workspace/core/companion-protocol';
import type { CompanionSession } from './companion-port';

export type GitDiffChoice = { id: string; label: string; detail?: string; target: AgentGitDiffTarget; summary: AgentGitDiffSummary };

/** One read-only Changes view, bound to the selected host and conversation. */
export function createGitChanges(options: {
  owner: () => string;
  agent: () => Agent | null;
  status: () => CompanionGitStatus | null;
  session: () => CompanionSession | null;
  connected: () => boolean;
}) {
  const status = ref<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  const scopeId = ref('uncommitted');
  const result = shallowRef<AgentGitDiff | null>(null);
  let epoch = 0;
  const choices = computed<GitDiffChoice[]>(() => {
    const git = options.status(); const catalog = git?.diffCatalog;
    const fallback = { changedFiles: git?.changedFiles ?? 0, addedLines: git?.addedLines ?? 0, removedLines: git?.removedLines ?? 0 };
    return [
      ...(catalog?.branch ? [{ id: 'branch', label: 'Branch changes', detail: catalog.branch.baseRef, target: { type: 'branch' as const, baseRef: catalog.branch.baseRef }, summary: catalog.branch }] : []),
      { id: 'uncommitted', label: 'Uncommitted changes', target: { type: 'uncommitted' as const }, summary: catalog?.uncommitted ?? fallback },
      { id: 'unstaged', label: 'Unstaged changes', target: { type: 'unstaged' as const }, summary: catalog?.unstaged ?? fallback },
      { id: 'staged', label: 'Staged changes', target: { type: 'staged' as const }, summary: catalog?.staged ?? fallback },
      ...(git?.lastTurn ? [{ id: `turn:${git.lastTurn.turnId}`, label: 'Last turn changes', target: { type: 'turn' as const, turnId: git.lastTurn.turnId }, summary: { ...git.lastTurn, changedFiles: 0 } }] : []),
      ...(catalog?.commits ?? []).map(commit => ({ id: `commit:${commit.sha}`, label: commit.subject, detail: commit.shortSha,
        target: { type: 'commit' as const, sha: commit.sha }, summary: commit })),
    ];
  });
  const available = computed(() => {
    const agent = options.agent(); const git = options.status();
    return Boolean(agent && agent.sessionKind !== 'quickChat' && (agent.workspace?.kind === 'git' || (git && git.state !== 'unknown')));
  });
  const view = computed(() => ({ available: available.value, uncommitted: options.status(), status: status.value,
    scopeId: scopeId.value, choices: choices.value, summary: result.value?.summary ?? choices.value.find(choice => choice.id === scopeId.value)?.summary ?? null }));
  function clear() { ++epoch; status.value = 'idle'; scopeId.value = 'uncommitted'; result.value = null; }
  const stop = watch(() => [options.owner(), options.connected()], clear, { flush: 'sync' });
  async function load(id = scopeId.value) {
    const choice = choices.value.find(choice => choice.id === id);
    const agent = options.agent(); const session = options.session();
    if (!choice || !agent || !session || !options.connected() || !available.value) return;
    const owner = options.owner(); const request = ++epoch;
    scopeId.value = id; status.value = 'loading'; result.value = null;
    const current = () => request === epoch && owner === options.owner() && session === options.session() && options.connected();
    try {
      if (!session.gitDiff) throw new Error('Git changes unavailable.');
      const diff = await session.gitDiff(agent.id, choice.target);
      if (current()) { result.value = diff; status.value = 'loaded'; }
    } catch { if (current()) status.value = 'failed'; }
  }
  return { view, result, load, clear, dispose() { stop(); clear(); } };
}
