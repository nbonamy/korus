<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect :x="pose === 'folded' ? 6 : 2" :y="pose === 'folded' ? 3 : 4" :width="pose === 'folded' ? 12 : 20" :height="pose === 'folded' ? 18 : 16" rx="2" fill="currentColor" fill-opacity="0.12" />
    <path :d="pose === 'folded' ? 'M10 18.5h4' : 'M10 17.5h4'" stroke-width="1.25" />
    <circle v-if="pose === 'folded'" cx="15" cy="6" r="0.55" fill="currentColor" stroke="none" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ pose: 'folded' | 'unfolded' }>();
</script>
