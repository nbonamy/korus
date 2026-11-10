import path from 'node:path';
import { homedir } from 'node:os';
import * as runtime from '@korus-dev/multi-agent-sdk/runtime';
import { product } from './product';
export type RuntimeDiscoveryDependencies = runtime.RuntimeDiscoveryDependencies;
export const privateBinEngines = ['codex', 'claude'] as const;
const configured = (dependencies: RuntimeDiscoveryDependencies = {}): RuntimeDiscoveryDependencies => ({
  ...dependencies,
  privateBinDirectory: dependencies.privateBinDirectory ?? path.join((dependencies.homedir ?? homedir)(), product.homeDirectory, 'bin'),
  privateBinEngines: dependencies.privateBinEngines ?? privateBinEngines,
});
export const clearRuntimeDiscoveryCache = runtime.clearRuntimeDiscoveryCache;
export const discoveredRuntimePath = (dependencies?: RuntimeDiscoveryDependencies) => runtime.discoveredRuntimePath(configured(dependencies));
export const discoveredRuntimePathEntries = (dependencies?: RuntimeDiscoveryDependencies) => runtime.discoveredRuntimePathEntries(configured(dependencies));
export const withDiscoveredRuntimePath = (env: NodeJS.ProcessEnv | undefined, dependencies?: RuntimeDiscoveryDependencies) => runtime.withDiscoveredRuntimePath(env, configured(dependencies));
export const resolveRuntimeExecutable = (executable: string, dependencies?: RuntimeDiscoveryDependencies) => runtime.resolveRuntimeExecutable(executable, configured(dependencies));
export const resolveRuntimeLaunch = (command: string, overrides?: NodeJS.ProcessEnv, dependencies?: RuntimeDiscoveryDependencies) => runtime.resolveRuntimeLaunch(command, overrides, configured(dependencies));
