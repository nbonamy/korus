<template>
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" class="backlog-shortcut-icon">
    <template v-if="kind === 'issue'">
      <circle class="backlog-shortcut-icon__tint" cx="28" cy="28" r="20" />
      <circle class="backlog-shortcut-icon__fill" cx="28" cy="28" r="4" />
      <circle class="backlog-shortcut-icon__paper" cx="47" cy="47" r="12" />
      <circle cx="47" cy="43" r="3" />
      <path d="M41 53a6 6 0 0 1 12 0" />
    </template>
    <template v-else-if="kind === 'pullRequest'">
      <path d="M18 19v26" />
      <path class="backlog-shortcut-icon__accent" d="M46 45V28a10 10 0 0 0-10-10h-7m6-6-6 6 6 6" />
      <circle class="backlog-shortcut-icon__tint" cx="18" cy="13" r="6" />
      <circle class="backlog-shortcut-icon__paper" cx="18" cy="51" r="6" />
      <circle class="backlog-shortcut-icon__fill" cx="46" cy="51" r="6" />
    </template>
    <template v-else-if="kind === 'repository'">
      <path class="backlog-shortcut-icon__paper" d="M29 53H16a6 6 0 0 1-6-6V15a6 6 0 0 1 6-6h26v19M10 43h19" />
      <path d="M18 10v33m7-25h10m-10 8h6" />
      <rect class="backlog-shortcut-icon__tint" x="30" y="31" width="28" height="27" rx="4" />
      <circle class="backlog-shortcut-icon__fill" cx="37" cy="39" r="2" />
      <path class="backlog-shortcut-icon__accent" d="M44 39h7m-16 9 3 3 5-6m3 5h5" />
    </template>
    <template v-else-if="kind === 'review'">
      <path class="backlog-shortcut-icon__paper" d="M23 53h-9a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4h20l12 12v13M34 8v12h12" />
      <path d="M18 27h18m-18 8h9" />
      <path class="backlog-shortcut-icon__tint" d="M25 47s6-10 17-10 17 10 17 10-6 10-17 10-17-10-17-10z" />
      <circle class="backlog-shortcut-icon__fill" cx="42" cy="47" r="4" />
    </template>
    <template v-else>
      <rect class="backlog-shortcut-icon__paper" x="20" y="7" width="32" height="27" rx="4" />
      <rect class="backlog-shortcut-icon__tint" x="12" y="15" width="32" height="27" rx="4" />
      <path class="backlog-shortcut-icon__accent" d="M20 24h16m-16 8h10" />
      <path class="backlog-shortcut-icon__paper" d="m13 34-6 9v10a4 4 0 0 0 4 4h42a4 4 0 0 0 4-4V43l-6-9M7 43h16l4 6h10l4-6h16" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ kind: 'issue' | 'pullRequest' | 'repository' | 'review' | 'all' }>();
</script>

<style scoped>
.backlog-shortcut-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  stroke: var(--color-text-muted);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.backlog-shortcut-icon__paper {
  fill: var(--color-surface-lowest);
}

.backlog-shortcut-icon__accent,
.backlog-shortcut-icon__tint {
  stroke: var(--color-primary);
}

.backlog-shortcut-icon__tint {
  fill: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface-lowest));
}

.backlog-shortcut-icon__fill {
  fill: var(--color-primary);
  stroke: none;
}
</style>
