<template>
  <el-dialog
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :model-value="visible"
    :show-close="false"
    append-to-body
    class="app-dialog"
    :title="$t('surface.codexResourceSharingMigrationDialog.shareSkillsAndPluginsWithChatGPT')"
    width="460px"
  >
    <p class="codex-resource-sharing-migration-dialog__copy"> {{ $t('surface.codexResourceSharingMigrationDialog.appCanUseTheSkillsAndPluginsInstalledInChatGPTMigr') }} <code>{{ $t('surface.codexResourceSharingMigrationDialog.codex') }}</code>.
    </p>
    <p
      v-if="blocked"
      class="codex-resource-sharing-migration-dialog__warning"
      role="status"
    > {{ $t('surface.codexResourceSharingMigrationDialog.migrationCannotRunWhileChatsAreActiveWaitForThemToFinish') }} </p>
    <template #footer>
      <div class="app-dialog__footer">
        <button
          class="app-button app-button--tertiary"
          type="button"
          :disabled="pending"
          @click="$emit('decline')"
        > {{ $t('surface.codexResourceSharingMigrationDialog.keepIsolated') }} </button>
        <button
          class="app-button app-button--primary"
          type="button"
          :aria-busy="pending"
          :disabled="blocked || pending"
          @click="$emit('migrate')"
        > {{ $t('surface.codexResourceSharingMigrationDialog.migrate') }} </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
defineProps<{
  blocked: boolean;
  pending: boolean;
  visible: boolean;
}>();

defineEmits<{
  decline: [];
  migrate: [];
}>();
</script>

<style scoped>
.codex-resource-sharing-migration-dialog__copy,
.codex-resource-sharing-migration-dialog__warning {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.codex-resource-sharing-migration-dialog__warning {
  margin-top: var(--space-12);
  color: var(--color-warning);
}

.codex-resource-sharing-migration-dialog__copy code {
  font-family: var(--font-family-mono);
}
</style>
