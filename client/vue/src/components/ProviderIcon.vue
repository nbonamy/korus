<template>
  <span v-if="source && themed" class="provider-icon provider-icon--monochrome" :style="maskStyle" aria-hidden="true" />
  <img v-else-if="source" class="provider-icon" :src="source" alt="" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HarnessProvider } from '@workspace/core/contracts';

const props = defineProps<{ provider: HarnessProvider; monochrome?: boolean }>();
const icons: Partial<Record<HarnessProvider, string>> = {
  codex: new URL('../shared/icons/chatgpt-icon.svg', import.meta.url).href,
  claude: new URL('../shared/icons/claude-code-icon.svg', import.meta.url).href,
  cursor: new URL('../shared/icons/cursor-icon.svg', import.meta.url).href,
  antigravity: new URL('../shared/icons/antigravity-icon.svg', import.meta.url).href,
};
// Claude keeps its brand colors; the other marks are single-color glyphs that must follow the theme text color.
const themed = computed(() => props.monochrome || props.provider !== 'claude');
const source = computed(() => icons[props.provider]);
const maskStyle = computed(() => ({ maskImage: `url(${JSON.stringify(source.value)})` }));
</script>

<style scoped>
.provider-icon {
  width: 18px;
  height: 18px;
  flex: none;
}
.provider-icon--monochrome {
  background-color: currentColor;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}
</style>
