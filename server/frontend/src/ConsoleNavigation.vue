<template>
  <aside class="sidebar">
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
    <nav aria-label="Analytics sections">
      <RouterLink
        v-for="item in consolePages"
        :key="item.id"
        class="section-link"
        :to="{ name: item.id }"
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
import { RouterLink } from "vue-router";
import { consolePages } from "./console-pages";
import { QuitIcon } from "@workspace/vue/shared/icons/app-icons";
import productIcon from "../../../client/electron/assets/icon.svg";
defineProps<{
  productName: string;
  signingOut?: boolean;
  authError?: string;
}>();
const emit = defineEmits<{ signOut: [] }>();
</script>
