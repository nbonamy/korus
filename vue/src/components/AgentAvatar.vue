<template>
  <span
    class="agent-avatar"
    :class="[`agent-avatar--${size}`, { 'agent-avatar--emoji': isEmojiAvatar, 'agent-avatar--square': shape === 'square' }]"
    :aria-label="label"
  >
    <img
      v-if="isImageAvatar"
      class="agent-avatar__image"
      :src="avatar"
      alt=""
      draggable="false"
    />
    <span
      v-else
      class="agent-avatar__text"
      aria-hidden="true"
    >
      {{ displayText }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  avatar?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'circle' | 'square';
}>(), {
  avatar: undefined,
  size: 'md',
  shape: 'circle',
});

const isImageAvatar = computed(() => props.avatar?.startsWith('data:image/') ?? false);
const isEmojiAvatar = computed(() => !isImageAvatar.value && /\p{Extended_Pictographic}/u.test(props.avatar ?? ''));
const displayText = computed(() => props.avatar || initials(props.name));
const label = computed(() => `${props.name} avatar`);

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }

  return name.trim().slice(0, 2).toUpperCase() || 'AG';
}
</script>

<style scoped>
.agent-avatar {
  --agent-avatar-size: var(--space-16);
  --agent-avatar-font-size: var(--font-size-18);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--agent-avatar-size);
  height: var(--agent-avatar-size);
  overflow: hidden;
  border-radius: var(--radius-full);
  /* background: var(--color-primary); */
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: var(--agent-avatar-font-size);
  font-weight: var(--font-weight-semibold);
  line-height: 1;
}

.agent-avatar--xs {
  --agent-avatar-size: var(--space-8);
  --agent-avatar-font-size: var(--font-size-8);
}

.agent-avatar--square {
  border: 0;
  border-radius: var(--radius-sm);
}

.agent-avatar--sm {
  --agent-avatar-size: var(--space-12);
  --agent-avatar-font-size: var(--font-size-11);
}

.agent-avatar--lg {
  --agent-avatar-size: var(--space-20);
  --agent-avatar-font-size: var(--font-size-18);
}

.agent-avatar--xl {
  --agent-avatar-size: var(--space-24);
  --agent-avatar-font-size: var(--font-size-20);
}

.agent-avatar--emoji {
  overflow: visible;
  border: 0;
  font-size: calc(var(--agent-avatar-size) - 1px);
  position: relative;
  top: -1px;
}

.agent-avatar__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.agent-avatar__text {
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
