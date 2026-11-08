<template>
  <FormRow :title="$t('engineSetup.title')" :description="$t(home?.isolated !== false ? 'auth.separateChats' : 'auth.existingSetup')">
    <template #control>
      <el-button v-if="!capabilities || capabilities.homeSelection || capabilities.skillSharing" @click="emit('customize')">{{ $t('auth.customize') }}</el-button>
    </template>
    <template #copy><span v-if="home" class="form-row__description">{{ home.homePath }}</span></template>
  </FormRow>
</template>

<script setup lang="ts">
import type { ProviderHomeSettings, ProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';
import FormRow from '../shared/form/FormRow.vue';
defineProps<{ home?: ProviderHomeSettings; capabilities?: ProviderSetupCapabilities }>();
const emit = defineEmits<{ customize: [] }>();
</script>
