import * as runtime from '@korus-dev/multi-agent-sdk/providers/antigravity';
import { backendHomeDir } from '../state';
import { withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
export const acpEnvironment = (home: string, harness: string, temporary: string) => runtime.acpEnvironment(home, harness, temporary, withDiscoveredRuntimePath(undefined));
export const antigravityHome = () => runtime.antigravityHome(backendHomeDir());
export const resolveAcpRuntime = () => runtime.resolveAcpRuntime(backendHomeDir(), { command: process.env.APP_ANTIGRAVITY_COMMAND, harnessPath: process.env.ANTIGRAVITY_HARNESS_PATH });
