import { config, disableAutoUnmount, enableAutoUnmount } from '@vue/test-utils';
import { computed } from 'vue';
import { backendChoicesKey } from '../components/backend-selection';
import { resetProvisioningOperations } from '../components/provisioning-operations';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { i18n } from '../i18n';
import { configureAppClient } from '../platform-api';
import { installElectronTestClientAccessor, setElectronTestClient } from './client';
import { elementPlusStubs } from './element-plus-stubs';

// Reset before setup imports so hooks and components share the same app singletons.
vi.hoisted(() => vi.resetModules());

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
// Vue Test Utils is shared by reused VM workers; each suite must own its cleanup hook.
afterAll(disableAutoUnmount);

afterEach(() => {
  setElectronTestClient();
  delete window.app;
  configureAppClient(undefined);
  vi.unstubAllGlobals();
});
