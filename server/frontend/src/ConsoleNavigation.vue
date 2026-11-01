<template>
  <aside class="sidebar">
    <a
      class="brand"
      href="#/overview"
      :aria-label="`${productName} Console home`"
    >
      <img :src="productIcon" alt="" width="36" height="36" />
      <span class="brand-copy"
        ><strong>{{ productName }}</strong
        ><span>Console</span></span
      >
    </a>
    <span class="navigation-group">Reporting</span>
    <nav aria-label="Analytics sections">
      <a
        v-for="item in sections"
        :key="item.id"
        class="section-link"
        :href="`#/${item.id}`"
        :aria-current="page === item.id ? 'page' : undefined"
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
      </a>
    </nav>
    <div class="sidebar-session">
      <button
        type="button"
        class="sign-out-button"
        aria-label="Sign out"
        :disabled="signingOut"
        @click="emit('signOut')"
      >
        <QuitIcon aria-hidden="true" /><span>{{
          signingOut ? "Signing out…" : "Sign out"
        }}</span>
      </button>
      <p v-if="authError" role="alert" class="sign-out-error">
        {{ authError }}
      </p>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { QuitIcon } from "@workspace/vue/shared/icons/app-icons";
import productIcon from "../../../client/electron/assets/icon.svg";
defineProps<{
  productName: string;
  page: string;
  signingOut?: boolean;
  authError?: string;
}>();
const emit = defineEmits<{ signOut: [] }>();
const sections = [
  {
    id: "overview",
    label: "Overview",
    icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  },
  { id: "activity", label: "Activity", icon: "M3 12h4l3-8 4 16 3-8h4" },
  {
    id: "models",
    label: "Models",
    icon: "M4 4h16v16H4zM4 9h16M9 9v11M4 14h16",
  },
  {
    id: "tokens",
    label: "Tokens",
    icon: "M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7",
  },
  {
    id: "spend",
    label: "Spend",
    icon: "M12 3v18M17 7c-1-3-10-3-10 1 0 5 10 2 10 7 0 4-9 4-11 1",
  },
  {
    id: "performance",
    label: "Performance",
    icon: "M4 17a9 9 0 1 1 16 0M12 12l5-5M6 17h12",
  },
];
</script>
