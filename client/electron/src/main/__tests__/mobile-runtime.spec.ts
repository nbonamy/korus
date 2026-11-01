import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mobileRuntimePaths } from '../mobile/runtime';
afterEach(() => vi.unstubAllEnvs());
it('uses shipped resources in packaged apps regardless of developer overrides', () => {
  vi.stubEnv('APP_MOBILE_COMPANION_PATH', '/external/idb_companion');
  expect(mobileRuntimePaths({ isPackaged: true, appPath: '/app', resourcesPath: '/resources' })).toEqual({
    companionPath: path.join('/resources', 'mobile-simulator/idb_companion'),
    protoPath: path.join('/resources', 'mobile-simulator/idb.proto'),
  });
});
it('uses prepared native assets for development and permits an isolated companion override', () => {
  vi.stubEnv('APP_MOBILE_COMPANION_PATH', '');
  const host = { isPackaged: false, appPath: '/checkout/electron', resourcesPath: '/resources' };
  expect(mobileRuntimePaths(host).companionPath).toBe(
    path.join(host.appPath, '.mobile-simulator/mobile-simulator/idb_companion'),
  );
  vi.stubEnv('APP_MOBILE_COMPANION_PATH', '/external/idb_companion');
  expect(mobileRuntimePaths(host)).toEqual({
    companionPath: '/external/idb_companion',
    protoPath: path.join(host.appPath, 'resources/mobile-simulator/idb.proto'),
  });
});
