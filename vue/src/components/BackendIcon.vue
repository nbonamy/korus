<template>
  <span v-if="themed" class="backend-icon backend-icon--monochrome" :style="maskStyle" aria-hidden="true" />
  <img v-else class="backend-icon" :src="source" alt="" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AgentBackend } from '@workspace/core/contracts';

const props = defineProps<{ backend: AgentBackend; monochrome?: boolean }>();
const icons = {
  codex: new URL('../shared/icons/chatgpt-icon.svg', import.meta.url).href,
  claude: new URL('../shared/icons/claude-code-icon.svg', import.meta.url).href,
  antigravity: new URL('../shared/icons/antigravity-icon.svg', import.meta.url).href,
};
// Claude keeps its brand colors; the other marks are single-color glyphs that must follow the theme text color.
const themed = computed(() => props.monochrome || props.backend !== 'claude');
const source = computed(() => icons[props.backend]);
const maskStyle = computed(() => ({ maskImage: `url(${JSON.stringify(source.value)})` }));
</script>

<style scoped>
.backend-icon {
  width: 18px;
  height: 18px;
  flex: none;
}
.backend-icon--monochrome {
  background-color: currentColor;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}
</style>
