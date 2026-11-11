import * as runtime from '@korus-dev/multi-agent-sdk/runtime';
import { backendHomeDir } from '../state';
export const resolveAcpRuntime = () => runtime.resolveAcpRuntime(backendHomeDir(), { command: process.env.APP_ANTIGRAVITY_COMMAND, harnessPath: process.env.ANTIGRAVITY_HARNESS_PATH });
