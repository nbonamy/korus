<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--open': navigationOpen }"
    @keydown.esc="closeNavigation"
  >
    <div class="sidebar-header">
      <RouterLink
        class="brand"
        :to="{ name: 'overview' }"
        :aria-label="`${productName} Console home`"
      >
        <img :src="productIcon" alt="" width="36" height="36" />
        <span class="brand-copy"
          ><strong>{{ productName }}</strong
          ><span>Console</span></span
        >
      </RouterLink>
      <button
        ref="navigationToggle"
        class="navigation-toggle"
        type="button"
        aria-label="Toggle navigation"
        aria-controls="console-sections"
        :aria-expanded="navigationOpen"
        @click="navigationOpen = !navigationOpen"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path
            :d="
              navigationOpen
                ? 'M6 6l12 12M6 18L18 6'
                : 'M4 6h16M4 12h16M4 18h16'
            "
          />
        </svg>
      </button>
    </div>
    <nav id="console-sections" aria-label="Analytics sections">
      <RouterLink
        v-for="item in consolePages"
        :key="item.id"
        class="section-link"
        :to="{ name: item.id }"
        @click="navigationOpen = false"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path :d="item.icon" />
        </svg>
        {{ item.label }}
      </RouterLink>
    </nav>
    <div class="sidebar-session">
      <button
        type="button"
        class="sign-out-button"
        aria-label="Sign out"
        :disabled="signingOut"
        @click="emit('signOut')"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        >
          <path d="M9 5H4v14h5M14 8l4 4-4 4M8 12h10" /></svg
        ><span>{{ signingOut ? "Signing out…" : "Sign out" }}</span>
      </button>
      <p v-if="authError" role="alert" class="sign-out-error">
        {{ authError }}
      </p>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { consolePages } from "./console-pages";
import productIcon from "./assets/icon.svg";
defineProps<{
  productName: string;
  signingOut?: boolean;
  authError?: string;
}>();
const emit = defineEmits<{ signOut: [] }>();
const navigationOpen = ref(false);
const navigationToggle = ref<HTMLButtonElement>();
const route = useRoute();
watch(
  () => route.name,
  () => {
    navigationOpen.value = false;
  },
);
function closeNavigation() {
  if (!navigationOpen.value) return;
  navigationOpen.value = false;
  navigationToggle.value?.focus();
}
</script>
