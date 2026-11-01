import type { AppApi } from '@workspace/core/contracts';
import { configureAppClient } from '../platform-api';
import { createClientApiMock } from './client-api-mock';

let disposeClient = () => {};
let assignClient: ((api?: Partial<AppApi>) => void) | undefined;

export function configureElectronTestClient(overrides?: Partial<AppApi>): AppApi | undefined {
  disposeClient();
  disposeClient = () => {};
  if (!overrides) {
    configureAppClient(undefined);
    return undefined;
  }
  const mock = createClientApiMock();
  const api = Object.assign(mock.api, overrides);
  disposeClient = mock.dispose;
  configureAppClient({ api, platform: 'desktop' });
  return api;
}

export function installElectronTestClientAccessor(): void {
  const existing = window.app;
  let api: AppApi | undefined;
  let initialized = false;
  const initialize = () => {
    if (!initialized) {
      api = configureElectronTestClient(existing ?? {});
      initialized = true;
    }
    return api;
  };
  assignClient = (value) => {
    api = configureElectronTestClient(value);
    initialized = true;
  };
  Object.defineProperty(window, 'app', {
    configurable: true,
    get: initialize,
    set: assignClient,
  });
}

export function setElectronTestClient(api?: Partial<AppApi>): void {
  if (!assignClient) installElectronTestClientAccessor();
  assignClient!(api);
}

export function stubElectronTestWindow(value: { app?: Partial<AppApi> }): void {
  setElectronTestClient(value.app);
}

/** Only for legacy/missing-method compatibility tests, never normal UI integration. */
export function stubLegacyElectronTestWindow(value: { app: Partial<AppApi> }): void {
  setElectronTestClient(value.app);
  for (const key of Object.keys(window.app!)) {
    if (!(key in value.app)) Reflect.deleteProperty(window.app!, key);
  }
}
