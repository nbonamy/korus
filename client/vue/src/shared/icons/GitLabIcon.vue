<template>
  <IconBrandGitlab class="gitlab-icon" :size="size" aria-hidden="true" />
</template>

<script setup lang="ts">
import { IconBrandGitlab } from '@tabler/icons-vue';
withDefaults(defineProps<{ size?: number | string }>(), { size: 'var(--icon-md)' });
</script>
