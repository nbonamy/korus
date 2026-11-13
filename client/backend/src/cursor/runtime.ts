import * as runtime from '@korus-dev/multi-agent-sdk/runtime';
import { withDiscoveredRuntimePath, resolveRuntimeExecutable } from '@workspace/core/runtime-discovery';
import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
export { cursorHome, cursorVersion, cursorEnvironment } from '@korus-dev/multi-agent-sdk/runtime';
export const resolveCursorExecutable = () => resolveRuntimeExecutable('agent') ?? resolveRuntimeExecutable('cursor-agent');
export const cursorRuntime = (home?: ProviderHomeSettings) => runtime.cursorRuntime(home, withDiscoveredRuntimePath(undefined));
