<template>
  <div
    class="new-agent-button"
    :class="[
      `new-agent-button--${tone}`,
      `new-agent-button--${size}`,
      `new-agent-button--${presentation}`,
    ]"
  >
    <PlusCircleIcon
      v-if="detachedIcon"
      class="new-agent-button__detached-icon"
      aria-hidden="true"
    />
    <el-button
      :type="buttonType"
      class="agent-sidebar__new new-agent-button__primary"
      :aria-label="label"
      @click="emit('new-agent')"
    >
      <PlusCircleIcon v-if="!detachedIcon" class="new-agent-button__icon" />
      <span class="new-agent-button__label">{{ label }}</span>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { translate } from '../i18n';
import { PlusCircleIcon } from '../shared/icons/app-icons';

type NewAgentButtonPresentation = 'default' | 'tile';
type NewAgentButtonSize = 'regular' | 'small';
type NewAgentButtonTone = 'primary' | 'muted' | 'ghost';

const props = withDefaults(defineProps<{
  label?: string;
  presentation?: NewAgentButtonPresentation;
  size?: NewAgentButtonSize;
  tone?: NewAgentButtonTone;
}>(), {
  label: translate('surface.newAgentButton.newAgent'),
  presentation: 'default',
  size: 'regular',
  tone: 'primary',
});

const emit = defineEmits<{ 'new-agent': [] }>();
const buttonType = computed(() => props.tone === 'primary' ? 'primary' : undefined);
const detachedIcon = computed(() => props.tone !== 'primary');
</script>

<style scoped>
.new-agent-button {
  --new-agent-button-height: 44px;
  --new-agent-button-border-radius: var(--radius-lg);
  --new-agent-button-color: white;
  --new-agent-button-bg: var(--color-primary);
  --new-agent-button-border: var(--color-primary);
  --new-agent-button-hover-bg: color-mix(in srgb, var(--color-primary) 80%, var(--color-background));
  --new-agent-button-hover-border: color-mix(in srgb, var(--color-primary) 80%, var(--color-background));
  --new-agent-button-padding-inline: var(--space-8);
  --new-agent-button-icon-display: none;
  width: 100%;
}

.new-agent-button--small {
  --new-agent-button-height: 24px;
  --new-agent-button-border-radius: var(--radius-md);
  --new-agent-button-padding-inline: var(--space-3);
  width: auto;
}

.new-agent-button--muted {
  --new-agent-button-height: 24px;
  --new-agent-button-color: var(--color-text-muted);
  --new-agent-button-bg: transparent;
  --new-agent-button-border: transparent;
  --new-agent-button-hover-bg: transparent;
  --new-agent-button-hover-border: transparent;
  --new-agent-button-icon-display: block;
}

.new-agent-button--ghost {
  --new-agent-button-color: var(--color-text-muted);
  --new-agent-button-bg: transparent;
  --new-agent-button-border: transparent;
  --new-agent-button-hover-bg: var(--color-surface-low);
  --new-agent-button-hover-border: transparent;
  --new-agent-button-icon-display: block;
}

.new-agent-button--muted,
.new-agent-button--ghost {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.new-agent-button--tile {
  width: auto;
  flex-direction: column;
  gap: var(--space-6);
  justify-content: center;
}

.new-agent-button__primary {
  width: 100%;
  height: var(--new-agent-button-height);
  min-height: var(--new-agent-button-height);
  border-color: var(--new-agent-button-border);
  border-radius: var(--new-agent-button-border-radius);
  color: var(--new-agent-button-color);
  background: var(--new-agent-button-bg);
  font-size: var(--font-size-14);
  line-height: var(--line-height-22);
  font-weight: var(--font-weight-semibold);
  justify-content: center;
  gap: var(--space-6);
  padding-inline: var(--new-agent-button-padding-inline);
}

.new-agent-button--small .new-agent-button__primary {
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.new-agent-button__primary:hover,
.new-agent-button__primary:focus-visible {
  color: var(--new-agent-button-color);
  background: var(--new-agent-button-hover-bg);
  border-color: var(--new-agent-button-hover-border);
}

.new-agent-button__icon {
  display: var(--new-agent-button-icon-display);
  width: var(--icon-md);
  height: var(--icon-md);
}

.new-agent-button__detached-icon {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--new-agent-button-color);
}

.new-agent-button--tile .new-agent-button__detached-icon {
  width: calc(var(--icon-xl) + var(--space-4));
  height: calc(var(--icon-xl) + var(--space-4));
}

.new-agent-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@container (max-width: 180px) {
  .new-agent-button__primary {
    min-width: 0;
    padding: 0;
  }

  .new-agent-button__icon {
    display: block !important;
  }

  .new-agent-button__label {
    display: none;
  }
}
</style>
