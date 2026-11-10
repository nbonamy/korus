import * as runtime from 'multi-agents-sdk/providers/cursor';
import { withDiscoveredRuntimePath, resolveRuntimeExecutable } from '@workspace/core/runtime-discovery';
import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
export { cursorHome, cursorVersion, cursorEnvironment } from 'multi-agents-sdk/providers/cursor';
export const resolveCursorExecutable = () => resolveRuntimeExecutable('agent') ?? resolveRuntimeExecutable('cursor-agent');
export const cursorRuntime = (home?: ProviderHomeSettings) => runtime.cursorRuntime(home, withDiscoveredRuntimePath(undefined));
