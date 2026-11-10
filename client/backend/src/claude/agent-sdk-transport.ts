import { ClaudeAgentSdkTransport as NativeTransport, type ClaudeAgentSdkTransportOptions as NativeOptions } from 'multi-agents-sdk/providers/claude';
import { product } from '@workspace/core/product';
import type { RuntimeDiscoveryDependencies } from '@workspace/core/runtime-discovery';
import { resolveClaudeLaunch } from './claude-command';
import { utilityMcpServers } from '../diagram-icons/utility-mcp';
import { debugMain, logMain } from '../log';
export type { ClaudeQueryRuntime, ClaudeQueryFactory } from 'multi-agents-sdk/providers/claude';
export type ClaudeAgentSdkTransportOptions = NativeOptions & { runtimeDiscovery?: RuntimeDiscoveryDependencies };
/** Product identity, utility restrictions and plan review remain application policy. */
export class ClaudeAgentSdkTransport extends NativeTransport {
  constructor(options: ClaudeAgentSdkTransportOptions = {}) {
    super({ ...options,
      client: { name: product.name, mcpServerName: product.mcpServerName, entrypoint: product.slug, clientApp: 'agent-workspace' },
      resolveLaunch: (command, env) => resolveClaudeLaunch(command, env, options.runtimeDiscovery),
      validateMcpServers: value => utilityMcpServers(value).map(server => ({ ...server, approval: 'auto' as const })),
      permissionResult: tool => tool === 'ExitPlanMode' ? { behavior: 'deny', message: `${product.name} captured the proposed plan. Wait for the user to review or request implementation.` } : undefined,
      disallowedTools: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'],
      log: (level, component, message, details) => (level === 'debug' ? debugMain : logMain)(component, message, details),
    });
  }
}
