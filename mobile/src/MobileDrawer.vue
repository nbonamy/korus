<template>
  <div class="mobile-drawer" :class="{ 'mobile-drawer--open': open }">
    <div class="mobile-drawer__scrim" @click="emit('close')" />
    <aside
      class="mobile-drawer__panel"
      role="dialog"
      aria-modal="true"
      :aria-label="t('mobile.agents')"
      :inert="open ? undefined : true"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <header class="mobile-drawer__header">
        <ProductMarkIcon class="mobile-drawer__mark" aria-hidden="true" />
        <strong>{{ product.name }}</strong>
        <button class="mobile-drawer__close" type="button" :aria-label="t('mobile.close')" @click="emit('close')">
          <X aria-hidden="true" />
        </button>
      </header>
      <div v-if="teams.length > 1" class="mobile-drawer__teams" role="tablist" :aria-label="t('mobile.teams')">
        <button
          v-for="team in teams"
          :key="team.id"
          class="mobile-drawer__team"
          type="button"
          role="tab"
          :aria-selected="team.id === teamId"
          @click="emit('select-team', team.id)"
        >
          <AgentAvatar v-if="team.avatar" :avatar="team.avatar" :name="team.name" size="xs" />
          <span>{{ team.name }}</span>
        </button>
      </div>
      <nav class="mobile-drawer__agents" :aria-label="t('mobile.agents')">
        <section v-for="group in groups" :key="group.id" class="mobile-drawer__group">
          <header class="mobile-drawer__group-header">
            <AgentAvatar v-if="group.icon" :avatar="group.icon" :name="group.label" size="xs" />
            <MessageIcon v-else-if="group.kind === 'quickChats'" aria-hidden="true" />
            <FolderRootIcon v-else aria-hidden="true" />
            <strong>{{ group.label }}</strong>
          </header>
          <button
            v-for="session in group.sessions"
            :key="session.agentId"
            class="mobile-drawer__agent"
            :class="{ 'mobile-drawer__agent--active': session.isActive }"
            type="button"
            :data-session-kind="session.kind"
            :aria-current="session.isActive ? 'true' : undefined"
            @click="emit('select-agent', session.agentId)"
          >
            <GitForkIcon v-if="group.kind === 'repository' && session.kind === 'worktree'" class="mobile-drawer__session-icon" aria-hidden="true" />
            <GitBranchIcon v-else-if="group.kind === 'repository'" class="mobile-drawer__session-icon" aria-hidden="true" />
            <span class="mobile-drawer__agent-text">{{ session.displayTitle }}</span>
            <span class="mobile-drawer__dot" :data-status="session.status.type" :aria-label="agentStatusLabel(session.status.type, t)" role="img" />
          </button>
        </section>
      </nav>
      <footer class="mobile-drawer__footer">
        <div class="mobile-drawer__connection" role="status" aria-live="polite">
          <span class="mobile-drawer__dot" :data-connection="status" aria-hidden="true" />
          <span>{{ t(`mobile.connection.${status}`) }}</span>
        </div>
        <div class="mobile-drawer__actions">
          <button v-if="status === 'connected'" class="app-button app-button--secondary" type="button" @click="emit('disconnect')">{{ t('mobile.disconnect') }}</button>
          <button v-else-if="status === 'disconnected' || status === 'error'" class="app-button app-button--secondary" type="button" @click="emit('reconnect')">{{ t('mobile.reconnect') }}</button>
          <button class="app-button app-button--tertiary mobile-drawer__forget" type="button" @click="emit('forget')">{{ t('mobile.forget') }}</button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, Team } from '@workspace/core/contracts';
import { product } from '@workspace/core/product';
import AgentAvatar from '@workspace/vue/components/AgentAvatar.vue';
import { FolderRootIcon, GitBranchIcon, GitForkIcon, MessageIcon, ProductMarkIcon, X } from '@workspace/vue/shared/icons/app-icons';
import { agentStatusLabel } from '@workspace/vue/shared/agent-display';
import { projectMobileGroups } from './workspace-groups';

const props = defineProps<{
  open: boolean;
  teams: Team[];
  agents: Agent[];
  repositoryIcons?: Record<string, string>;
  teamId: string;
  agentId: string;
  status: string;
}>();
const emit = defineEmits<{
  close: [];
  'select-team': [id: string];
  'select-agent': [id: string];
  disconnect: [];
  reconnect: [];
  forget: [];
}>();
const { t } = useI18n();
const groups = computed(() => projectMobileGroups(props.agents, props.agentId || null, t('mobile.chats'), props.repositoryIcons));

let touchStart: { x: number; y: number } | null = null;
function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}
function onTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (touchStart && touch && touchStart.x - touch.clientX > 60 && Math.abs(touch.clientY - touchStart.y) < 40) emit('close');
  touchStart = null;
}
</script>

<style scoped>
.mobile-drawer {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}

.mobile-drawer--open { pointer-events: auto; }

.mobile-drawer__scrim {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--color-on-surface) 40%, transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.mobile-drawer--open .mobile-drawer__scrim { opacity: 1; }

.mobile-drawer__panel {
  position: absolute;
  inset: 0 auto 0 0;
  display: flex;
  flex-direction: column;
  width: min(86vw, 340px);
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  background: var(--color-shell-sidebar);
  border-right: 1px solid var(--color-border);
  transform: translateX(-100%);
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.24s;
}

.mobile-drawer--open .mobile-drawer__panel { transform: none; box-shadow: var(--shadow-lg); }

.mobile-drawer__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 56px;
  padding: 0 var(--space-4) 0 var(--space-8);
  font-size: var(--font-size-18);
}

.mobile-drawer__mark { width: 22px; height: 20px; }
.mobile-drawer__header strong { flex: 1; font-weight: var(--font-weight-bold); }

.mobile-drawer__close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
}

.mobile-drawer__close svg { width: var(--icon-xl); height: var(--icon-xl); }

.mobile-drawer__teams {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-8) var(--space-6);
  overflow-x: auto;
  scrollbar-width: none;
}

.mobile-drawer__team {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-4);
  min-height: 36px;
  padding: 0 var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  font-size: var(--font-size-14);
}

.mobile-drawer__team[aria-selected="true"] {
  border-color: transparent;
  color: var(--color-on-primary);
  background: var(--color-primary);
}

.mobile-drawer__agents {
  flex: 1;
  min-height: 0;
  padding: var(--space-2) var(--space-4);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mobile-drawer__group + .mobile-drawer__group { margin-top: var(--space-6); }

.mobile-drawer__group-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 36px;
  padding: 0 var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-15);
}

.mobile-drawer__group-header svg { flex: 0 0 auto; width: var(--icon-lg); height: var(--icon-lg); }
.mobile-drawer__group-header strong { min-width: 0; overflow: hidden; font-weight: var(--font-weight-semibold); text-overflow: ellipsis; white-space: nowrap; }

.mobile-drawer__agent {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  min-height: 48px;
  padding: var(--space-3) var(--space-6);
  border: 0;
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: transparent;
  text-align: left;
}

.mobile-drawer__agent--active { background: var(--color-surface-high); }

.mobile-drawer__session-icon { flex: 0 0 auto; width: var(--icon-lg); height: var(--icon-lg); color: var(--color-text-muted); }
.mobile-drawer__agent[data-session-kind="main"] .mobile-drawer__session-icon { color: var(--color-primary); }
.mobile-drawer__agent[data-session-kind="branch"] .mobile-drawer__session-icon { color: var(--color-success); }
.mobile-drawer__agent[data-session-kind="worktree"] .mobile-drawer__session-icon { color: var(--color-warning); }

.mobile-drawer__agent-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-drawer__dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--color-success);
}

.mobile-drawer__dot[data-status="idle"] { background: transparent; }
.mobile-drawer__dot[data-status="working"],
.mobile-drawer__dot[data-status="awaitingInput"],
.mobile-drawer__dot[data-connection="connecting"],
.mobile-drawer__dot[data-connection="reconnecting"] { background: var(--color-warning); }
.mobile-drawer__dot[data-status="error"],
.mobile-drawer__dot[data-connection="error"] { background: var(--color-error); }
.mobile-drawer__dot[data-connection="disconnected"],
.mobile-drawer__dot[data-connection="revoked"] { background: var(--color-outline); }

.mobile-drawer__footer {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8) var(--space-8);
  border-top: 1px solid var(--color-border);
}

.mobile-drawer__connection {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}

.mobile-drawer__actions { display: flex; gap: var(--space-4); }
.mobile-drawer__actions .app-button { flex: 1; min-height: 44px; }
.mobile-drawer__forget { color: var(--color-error); }

@media (prefers-reduced-motion: reduce) {
  .mobile-drawer__panel,
  .mobile-drawer__scrim { transition: none; }
}
</style>
