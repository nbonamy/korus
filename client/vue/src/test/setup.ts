import { config, enableAutoUnmount } from '@vue/test-utils';
import { computed } from 'vue';
import { backendChoicesKey } from '../components/backend-selection';
import { resetProvisioningOperations } from '../components/provisioning-operations';
import { afterEach, beforeEach, vi } from 'vitest';
import { i18n } from '../i18n';
import { configureAppClient } from '../platform-api';
import { installElectronTestClientAccessor, setElectronTestClient } from './client';
import { elementPlusStubs } from './element-plus-stubs';

beforeEach(() => {
  resetProvisioningOperations();
  localStorage.clear();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null,
  });
  installElectronTestClientAccessor();
});

config.global.renderStubDefaultSlot = true;
config.global.plugins = [i18n];
config.global.components = elementPlusStubs;
// Standalone component fixtures use a connected Codex host unless a test supplies
// another catalog. AppShell provides its own authoritative snapshot catalog.
config.global.provide = { [backendChoicesKey as symbol]: computed(() => ['codex']) };
enableAutoUnmount(afterEach);

afterEach(() => {
  setElectronTestClient();
  delete window.app;
  configureAppClient(undefined);
  vi.unstubAllGlobals();
});
