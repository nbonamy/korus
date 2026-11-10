import { installAcpRuntime as install } from 'multi-agents-sdk/providers/antigravity';
import { backendHomeDir } from '../state';
export const installAcpRuntime = () => install({ dataDirectory: backendHomeDir(), command: process.env.APP_ANTIGRAVITY_COMMAND, harnessPath: process.env.ANTIGRAVITY_HARNESS_PATH });
