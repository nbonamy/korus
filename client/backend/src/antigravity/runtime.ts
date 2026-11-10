import * as runtime from 'multi-agents-sdk/providers/antigravity/runtime';
import { backendHomeDir } from '../state';
import { withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
export const acpEnvironment = (home: string, harness: string, temporary: string) => runtime.acpEnvironment(home, harness, temporary, withDiscoveredRuntimePath(undefined));
export const antigravityHome = () => runtime.antigravityHome(backendHomeDir());
export const resolveAcpRuntime = () => runtime.resolveAcpRuntime(backendHomeDir());
