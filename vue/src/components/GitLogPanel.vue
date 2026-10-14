<template>
  <section class="git-log-panel" :aria-label="$t('gitLog.title')">
    <header class="git-log-panel__toolbar">
      <div class="git-log-panel__context">
        <span class="git-log-panel__branch"><GitBranchIcon aria-hidden="true" />{{ page ? (page.branch ?? $t('gitLog.detached')) : (branch ?? $t('gitLog.detached')) }}</span>
        <span class="git-log-panel__repository">{{ repository }}</span>
      </div>
      <button type="button" class="git-log-panel__refresh" :aria-label="$t('gitLog.refresh')" @click="refresh"><RefreshIcon aria-hidden="true" /></button>
    </header>
    <div class="git-log-panel__search">
      <ClearableTextInput v-model="search" :aria-label="$t('gitLog.search')" :placeholder="$t('gitLog.search')" :maxlength="200" />
    </div>
    <div ref="scrollRoot" class="git-log-panel__history" :aria-busy="loading">
      <p v-if="error" role="alert" class="git-log-panel__status">{{ error }}</p>
      <p v-if="loading && !commits.length" class="git-log-panel__status">{{ $t('gitLog.loading') }}</p>
      <p v-else-if="!error && !commits.length" class="git-log-panel__status">{{ $t(search ? 'gitLog.noMatches' : 'gitLog.empty') }}</p>
      <section v-for="group in groups" :key="group.key" class="git-log-panel__group">
        <h3>{{ group.label }}</h3>
        <article v-for="commit in group.commits" :key="commit.sha" class="git-log-panel__entry" :class="{ 'git-log-panel__entry--selected': selected === commit.sha }">
          <button type="button" class="git-log-panel__commit" :aria-expanded="selected === commit.sha" @click="selected = selected === commit.sha ? null : commit.sha">
            <span class="git-log-panel__dot" aria-hidden="true" />
            <span class="git-log-panel__commit-copy">
              <span class="git-log-panel__subject">{{ commit.subject }}</span>
              <span class="git-log-panel__meta">{{ commit.author }} · {{ commit.sha.slice(0, 8) }} · <time :datetime="commit.date" :title="new Date(commit.date).toLocaleString()">{{ new Date(commit.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</time></span>
            </span>
            <ChevronDown class="git-log-panel__chevron" :class="{ 'git-log-panel__chevron--up': selected === commit.sha }" aria-hidden="true" />
          </button>
          <GitLogCommitDetails v-if="selected === commit.sha && page?.head" :key="`${agent.id}:${page.head}:${commit.sha}`" :agent-id="agent.id" :head="page.head" :sha="commit.sha" />
        </article>
      </section>
      <button v-if="page?.nextCursor" type="button" class="git-log-panel__older" :aria-label="$t('gitLog.older')" :disabled="loading" @click="loadOlder">{{ $t(loading ? 'gitLog.loading' : 'gitLog.older') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Agent, AgentGitLogCommit, AgentGitLogPage } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import { ChevronDown, GitBranchIcon, RefreshIcon } from '../shared/icons/app-icons';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';
import GitLogCommitDetails from './GitLogCommitDetails.vue';

const props = defineProps<{ agent: Agent; branch?: string | null }>();
const search = ref('');
const page = ref<AgentGitLogPage | null>(null);
const commits = ref<AgentGitLogCommit[]>([]);
const selected = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const scrollRoot = ref<HTMLElement | null>(null);
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const repository = computed(() => page.value?.repository ?? (props.agent.workspace?.kind === 'git' ? props.agent.workspace.repositoryName : ''));
const groups = computed(() => {
  const result: { key: string; date: string; label: string; commits: AgentGitLogCommit[] }[] = [];
  const today = new Date().toDateString();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  for (const commit of commits.value) {
    const date = new Date(commit.date);
    const key = date.toDateString();
    let group = result.at(-1);
    if (group?.date !== key) {
      group = { key: `${key}:${commit.sha}`, date: key, label: key === today ? translate('gitLog.today') : key === yesterday.toDateString() ? translate('gitLog.yesterday') : date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }), commits: [] };
      result.push(group);
    }
    group.commits.push(commit);
  }
  return result;
});

function invalidate(): number {
  clearTimeout(timer);
  const id = ++generation;
  page.value = null; commits.value = []; selected.value = null; error.value = null;
  loading.value = true;
  if (scrollRoot.value) scrollRoot.value.scrollTop = 0;
  return id;
}
async function load(id: number, older = false): Promise<void> {
  const agentId = props.agent.id;
  const cursor = older ? page.value?.nextCursor : undefined;
  if (older && !cursor) return;
  loading.value = true;
  error.value = null;
  try {
    if (!appApi) throw new Error('Git history unavailable');
    const result = await appApi.getAgentGitLog(agentId, { search: search.value, ...(cursor ? { cursor } : {}) });
    if (id !== generation) return;
    page.value = result;
    commits.value = older ? [...commits.value, ...result.commits] : result.commits;
  } catch {
    if (id === generation) error.value = translate('gitLog.readError');
  } finally {
    if (id === generation) loading.value = false;
  }
}
function refresh(): void { void load(invalidate()); }
function loadOlder(): void { if (!loading.value) void load(generation, true); }
watch(search, () => { const id = invalidate(); timer = setTimeout(() => { void load(id); }, 250); }, { flush: 'sync' });
watch(() => [props.agent.id, props.agent.folder, props.agent.teamId, props.branch], () => {
  search.value = '';
  refresh();
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => { generation++; clearTimeout(timer); });
</script>

<style scoped>
.git-log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--color-text);
}

.git-log-panel__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8);
}

.git-log-panel__context {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.git-log-panel__branch {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-13);
  overflow-wrap: anywhere;
}

.git-log-panel__repository {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-log-panel__branch svg,
.git-log-panel__refresh svg,
.git-log-panel__chevron {
  flex: none;
  width: 16px;
  height: 16px;
}

.git-log-panel__refresh {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.git-log-panel__refresh:hover {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.git-log-panel__search {
  padding: 0 var(--space-8) var(--space-4);
}

.git-log-panel__history {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--space-4) var(--space-8);
}

.git-log-panel__status {
  padding: var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.git-log-panel__group h3 {
  margin: var(--space-6) var(--space-4) var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: 600;
  text-transform: uppercase;
}

.git-log-panel__entry {
  position: relative;
}

.git-log-panel__entry::before {
  content: "";
  position: absolute;
  top: 20px;
  bottom: -20px;
  left: 16px;
  width: 1px;
  background: var(--color-border);
}

.git-log-panel__entry:last-child::before {
  bottom: 12px;
}

.git-log-panel__commit {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  padding: var(--space-4) var(--space-6);
  border: 0;
  border-radius: var(--radius-sm);
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.git-log-panel__commit:hover {
  background: var(--color-surface-high);
}

.git-log-panel__entry--selected > .git-log-panel__commit {
  background: var(--color-primary-container);
}

.git-log-panel__dot {
  z-index: 1;
  flex: none;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--color-text-muted);
  border-radius: 50%;
  background: var(--color-surface);
}

.git-log-panel__entry--selected .git-log-panel__dot {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.git-log-panel__commit-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.git-log-panel__subject {
  font-size: var(--font-size-13);
  overflow-wrap: anywhere;
}

.git-log-panel__meta {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  overflow-wrap: anywhere;
}

.git-log-panel__chevron {
  visibility: hidden;
  color: var(--color-text-muted);
}

.git-log-panel__commit:hover .git-log-panel__chevron,
.git-log-panel__commit:focus-visible .git-log-panel__chevron,
.git-log-panel__entry--selected .git-log-panel__chevron {
  visibility: visible;
}

.git-log-panel__chevron--up {
  transform: rotate(180deg);
}

.git-log-panel__older {
  display: block;
  margin: var(--space-6) auto;
  padding: var(--space-3) var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-13);
}

button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
</style>
