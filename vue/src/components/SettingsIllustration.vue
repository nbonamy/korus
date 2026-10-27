<template>
  <svg class="settings-illustration" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <template v-if="kind === 'browser'">
      <circle class="settings-illustration__accent-surface" cx="32" cy="32" r="23" />
      <ellipse class="settings-illustration__accent" cx="32" cy="32" rx="10" ry="23" />
      <path class="settings-illustration__accent" d="M9 32h46" />
      <path class="settings-illustration__line" d="M13 19h38M13 45h38" />
    </template>
    <template v-else-if="kind === 'appshots'">
      <path class="settings-illustration__accent" d="M8 22V14a6 6 0 0 1 6-6h8M42 8h8a6 6 0 0 1 6 6v8M56 42v8a6 6 0 0 1-6 6h-8M22 56h-8a6 6 0 0 1-6-6v-8" />
      <rect class="settings-illustration__surface" x="15" y="15" width="34" height="34" rx="5" />
      <circle class="settings-illustration__dot settings-illustration__dot--error" cx="21" cy="21" r="1.8" />
      <circle class="settings-illustration__dot settings-illustration__dot--warning" cx="26.5" cy="21" r="1.8" />
      <circle class="settings-illustration__dot settings-illustration__dot--success" cx="32" cy="21" r="1.8" />
      <path class="settings-illustration__line" d="M20 29h24M20 35h24M20 41h14" />
    </template>
    <template v-else-if="kind === 'integrations'">
      <path class="settings-illustration__line" d="M32 32 14 16M32 32l18-16M32 32v22" />
      <circle class="settings-illustration__accent-fill" cx="32" cy="32" r="8" />
      <circle class="settings-illustration__surface" cx="13" cy="15" r="6" />
      <circle class="settings-illustration__surface" cx="51" cy="15" r="6" />
      <circle class="settings-illustration__surface" cx="32" cy="55" r="6" />
    </template>
    <template v-else-if="kind === 'voice'">
      <rect class="settings-illustration__accent-surface" x="23" y="8" width="18" height="30" rx="9" />
      <path class="settings-illustration__accent" d="M14 30a18 18 0 0 0 36 0M32 48v8" />
      <path class="settings-illustration__line" d="M5 24v8M59 24v8M10 20v16M54 20v16" />
    </template>
    <template v-else-if="kind === 'appearance'">
      <circle class="settings-illustration__surface" cx="32" cy="32" r="23" />
      <path class="settings-illustration__accent-fill" d="M32 9a23 23 0 0 1 0 46z" />
      <path class="settings-illustration__line" d="M12 12l5 5M52 12l-5 5M12 52l5-5" />
    </template>
    <template v-else-if="kind === 'personalization'">
      <circle class="settings-illustration__surface" cx="30" cy="24" r="10" />
      <path class="settings-illustration__surface" d="M10 56a20 20 0 0 1 40 0z" />
      <path class="settings-illustration__accent" d="M52 8v12M46 14h12" />
    </template>
    <template v-else-if="kind === 'git'">
      <path class="settings-illustration__line" d="M20 14v36" />
      <path class="settings-illustration__accent" d="M20 44c0-12 24-8 24-22" />
      <circle class="settings-illustration__surface" cx="20" cy="12" r="6" />
      <circle class="settings-illustration__surface" cx="20" cy="52" r="6" />
      <circle class="settings-illustration__accent-fill" cx="44" cy="20" r="6" />
    </template>
    <template v-else-if="kind === 'plugins'">
      <rect class="settings-illustration__surface" x="8" y="8" width="22" height="22" rx="5" />
      <rect class="settings-illustration__surface" x="34" y="8" width="22" height="22" rx="5" />
      <rect class="settings-illustration__surface" x="8" y="34" width="22" height="22" rx="5" />
      <rect class="settings-illustration__accent-fill" x="34" y="34" width="22" height="22" rx="5" />
      <path class="settings-illustration__on-accent" d="M45 40v10M40 45h10" />
    </template>
    <template v-else-if="kind === 'skills'">
      <path class="settings-illustration__surface" d="M16 8h22l12 12v32a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" />
      <path class="settings-illustration__line" d="M38 8v12h12M20 30h16M20 38h12M20 46h8" />
      <path class="settings-illustration__accent-fill" d="M46 36l2.6 6.4L55 45l-6.4 2.6L46 54l-2.6-6.4L37 45l6.4-2.6z" />
    </template>
    <template v-else-if="kind === 'workflows'">
      <rect class="settings-illustration__surface" x="6" y="8" width="20" height="16" rx="4" />
      <rect class="settings-illustration__accent-surface" x="38" y="8" width="20" height="16" rx="4" />
      <rect class="settings-illustration__surface" x="22" y="40" width="20" height="16" rx="4" />
      <path class="settings-illustration__line" d="M26 16h12" />
      <path class="settings-illustration__accent" d="M48 24v4a4 4 0 0 1-4 4H32v8" />
      <circle class="settings-illustration__accent-fill" cx="32" cy="48" r="2.4" />
    </template>
    <template v-else>
      <rect class="settings-illustration__surface" x="6" y="8" width="30" height="22" rx="4" />
      <path class="settings-illustration__line" d="M14 36h14" />
      <path class="settings-illustration__accent" d="M21 30v14a4 4 0 0 0 4 4h5" />
      <rect class="settings-illustration__accent-surface" x="28" y="36" width="30" height="22" rx="4" />
      <path class="settings-illustration__line" d="M14 17h14M14 22h8" />
      <circle class="settings-illustration__accent-fill" cx="36" cy="47" r="2.2" />
    </template>
  </svg>
</template>

<script setup lang="ts">
import type { SettingsIllustrationKind } from './settings-illustration';

defineProps<{ kind: SettingsIllustrationKind }>();
</script>

<style scoped>
.settings-illustration {
  width: var(--space-20);
  height: var(--space-20);
  flex: 0 0 auto;
}

.settings-illustration__accent {
  stroke: var(--color-primary);
  stroke-width: 3.5;
  stroke-linecap: round;
}

.settings-illustration__accent-fill {
  fill: var(--color-primary);
}

.settings-illustration__accent-surface {
  fill: var(--color-surface-lowest);
  stroke: var(--color-primary);
  stroke-width: 2.5;
}

.settings-illustration__surface {
  fill: var(--color-surface-lowest);
  stroke: var(--color-border-strong);
  stroke-width: 1.5;
}

.settings-illustration__line {
  stroke: var(--color-outline-variant);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.settings-illustration__on-accent {
  stroke: var(--color-on-primary);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.settings-illustration__dot--error {
  fill: var(--color-error);
}

.settings-illustration__dot--warning {
  fill: var(--color-warning);
}

.settings-illustration__dot--success {
  fill: var(--color-success);
}
</style>
