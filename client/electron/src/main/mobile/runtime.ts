import path from 'node:path';

export type MobileRuntimePaths = { companionPath: string; protoPath: string };

/** Packaged apps use only their own helper; development may select an isolated native installation. */
export function mobileRuntimePaths(host: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): MobileRuntimePaths {
  const directory = host.isPackaged
    ? path.join(host.resourcesPath, 'mobile-simulator')
    : path.join(host.appPath, '.mobile-simulator', 'mobile-simulator');
  return {
    companionPath: (!host.isPackaged && process.env.APP_MOBILE_COMPANION_PATH) || path.join(directory, 'idb_companion'),
    protoPath: host.isPackaged
      ? path.join(directory, 'idb.proto')
      : path.join(host.appPath, 'resources', 'mobile-simulator', 'idb.proto'),
  };
}
