import { installAcpRuntime as install } from 'multi-agents-sdk/providers/antigravity/installer';
import { backendHomeDir } from '../state';
export const installAcpRuntime = () => install({ dataDirectory: backendHomeDir() });
