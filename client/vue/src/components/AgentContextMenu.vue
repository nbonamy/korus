<template>
  <Teleport to="body">
    <div
      ref="menuRoot"
      class="agent-context-menu"
      :style="menuStyle"
    >
      <AppMenu
        :ariaLabel="t('agents.actions')"
        :items="menuItems"
        @select="selectMenuItem"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { OpenInApplication, OpenInApplicationCatalog, Team } from '@workspace/core/contracts';
import { defaultTeamColor } from '@workspace/core/team-colors';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import {
  ArrowsMinimizeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitForkIcon,
  MessageCircleIcon,
  PencilIcon,
  RefreshIcon,
  SwitchHorizontalIcon,
  ViewportShortIcon,
  X,
} from '../shared/icons/app-icons';
import { openInApplicationFromMenuItem, openInMenuItems } from '../shared/open-in';

export type AgentContextMenuAction =
  | 'share-agent'
  | 'close-agent'
  | 'compress-session'
  | 'compact-session'
  | 'duplicate-agent'
  | 'edit-agent'
  | 'fork-agent'
  | 'handoff-agent'
  | 'resume-session'
  | 'restart-agent';

const props = defineProps<{
  shared?: boolean;
  shareAvailable?: boolean;
  compressDisabled?: boolean;
  compressVisible?: boolean;
  compactDisabled?: boolean;
  resumeDisabled?: boolean;
  moveTargets?: Team[];
  forkDisabled?: boolean;
  openInCatalog?: OpenInApplicationCatalog;
  openInDisabled?: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  action: [action: AgentContextMenuAction];
  close: [];
  'move-agent-to-team': [teamId: string];
  'open-in': [application: OpenInApplication];
}>();

const { t } = useI18n();
const viewportMargin = 8;
const menuRoot = ref<HTMLElement | null>(null);
const menuPosition = ref({ x: props.x, y: props.y });
const moveTargets = computed(() => props.moveTargets ?? []);
const menuStyle = computed<Record<string, string>>(() => ({
  left: `${menuPosition.value.x}px`,
  overflow: 'visible',
  top: `${menuPosition.value.y}px`,
}));
const menuItems = computed<AppMenuItem[]>(() => props.shared ? [{ id: 'close-agent', type: 'action', label: t('guest.leave'), icon: X }] : [
  {
    id: 'edit-agent',
    type: 'action',
    label: t('agents.edit'),
    icon: PencilIcon,
  },
  {
    id: 'duplicate-agent',
    type: 'action',
    label: t('agents.duplicate'),
    icon: CopyIcon,
  },
  {
    id: 'fork-agent',
    type: 'action',
    label: t('agents.fork'),
    icon: GitForkIcon,
    disabled: props.forkDisabled === true,
  },
  ...(props.shareAvailable ? [{ id: 'share-agent', type: 'action', label: t('sharing.title'), icon: ExternalLinkIcon } satisfies AppMenuItem] : []),
  { id: 'group-primary', type: 'separator' },
  { id: 'handoff-agent', type: 'action', label: t('handoff.action'), icon: SwitchHorizontalIcon },
  ...(props.openInCatalog?.applications.length ? [{
    id: 'open-in',
    type: 'submenu',
    label: t('agents.openIn'),
    icon: ExternalLinkIcon,
    disabled: props.openInDisabled === true,
    items: openInMenuItems(props.openInCatalog),
  } satisfies AppMenuItem] : []),
  {
    id: 'move-to-team',
    type: 'submenu',
    label: t('agents.moveToTeam'),
    icon: SwitchHorizontalIcon,
    disabled: moveTargets.value.length === 0,
    items: moveTargets.value.map((team) => ({
      id: moveTeamItemId(team.id),
      type: 'action',
      label: team.name,
      leadingColor: team.color ?? defaultTeamColor,
    })),
  },
  { id: 'group-session', type: 'separator' },
  {
    id: 'compact-session',
    type: 'action',
    label: t('agents.compactSession'),
    icon: ViewportShortIcon,
    value: '⇧⌘K',
    disabled: props.compactDisabled === true,
  },
  ...(props.compressVisible === true ? [{
    id: 'compress-session',
    type: 'action',
    label: t('agents.replaceConversationWithSummary'),
    icon: ArrowsMinimizeIcon,
    disabled: props.compressDisabled === true,
  } satisfies AppMenuItem] : []),
  { id: 'group-lifecycle', type: 'separator' },
  {
    id: 'resume-session',
    type: 'action',
    label: t('agents.resumeSession'),
    icon: MessageCircleIcon,
    disabled: props.resumeDisabled === true,
  },
  {
    id: 'restart-agent',
    type: 'action',
    label: t('agents.restart'),
    icon: RefreshIcon,
  },
  {
    id: 'close-agent',
    type: 'action',
    label: t('agents.close'),
    icon: X,
    danger: true,
  },
]);

onMounted(() => {
  document.addEventListener('click', closeOnDocumentClick);
  document.addEventListener('keydown', closeOnEscape);
  window.addEventListener('resize', fitMenuInViewport);
  void nextTick(fitMenuInViewport);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeOnDocumentClick);
  document.removeEventListener('keydown', closeOnEscape);
  window.removeEventListener('resize', fitMenuInViewport);
});

watch(() => [props.x, props.y], ([x, y]) => {
  menuPosition.value = { x: x ?? 0, y: y ?? 0 };
  void nextTick(fitMenuInViewport);
});

function selectMenuItem(itemId: string): void {
  const application = openInApplicationFromMenuItem(itemId);
  if (application) {
    emit('open-in', application);
    return;
  }

  const teamId = teamIdFromMoveItemId(itemId);
  if (teamId) {
    emit('move-agent-to-team', teamId);
    return;
  }

  if (isAgentContextMenuAction(itemId)) {
    emit('action', itemId);
  }
}

function closeOnDocumentClick(event: MouseEvent): void {
  if (event.target instanceof Node && menuRoot.value?.contains(event.target)) {
    return;
  }

  emit('close');
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

function fitMenuInViewport(): void {
  const menu = menuRoot.value;
  if (!menu) return;

  const { width, height } = menu.getBoundingClientRect();
  menuPosition.value = {
    x: clampToViewport(props.x, width, window.innerWidth),
    y: clampToViewport(props.y, height, window.innerHeight),
  };
}

function clampToViewport(position: number, size: number, viewportSize: number): number {
  return Math.max(viewportMargin, Math.min(position, viewportSize - size - viewportMargin));
}

function moveTeamItemId(teamId: string): string {
  return `move-to-team:${teamId}`;
}

function teamIdFromMoveItemId(itemId: string): string | null {
  return itemId.startsWith('move-to-team:') ? itemId.slice('move-to-team:'.length) : null;
}

function isAgentContextMenuAction(itemId: string): itemId is AgentContextMenuAction {
  return itemId === 'share-agent' || itemId === 'close-agent' ||
    itemId === 'compress-session' ||
    itemId === 'compact-session' ||
    itemId === 'duplicate-agent' ||
    itemId === 'edit-agent' ||
    itemId === 'fork-agent' ||
    itemId === 'handoff-agent' ||
    itemId === 'resume-session' ||
    itemId === 'restart-agent';
}
</script>

<style scoped>
.agent-context-menu {
  position: fixed;
  z-index: 2000;
}
</style>
