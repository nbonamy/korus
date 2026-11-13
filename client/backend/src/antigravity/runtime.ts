import { resolveRuntimeExecutable } from '@workspace/core/runtime-discovery';
/** The Antigravity CLI installed on this machine. */
export const resolveAntigravityExecutable = () => process.env.APP_ANTIGRAVITY_COMMAND || resolveRuntimeExecutable('agy');
