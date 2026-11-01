<template>
  <WorkspaceProvisioningProgressDialog
    :operation="activeProvisioningOperation"
    @close="closeProvisioningOperation"
    @background="backgroundProvisioningOperation"
  />
</template>

<script setup lang="ts">
import WorkspaceProvisioningProgressDialog from './WorkspaceProvisioningProgressDialog.vue';
import { activeProvisioningOperation, backgroundProvisioningOperation, closeProvisioningOperation } from './provisioning-operations';
</script>
