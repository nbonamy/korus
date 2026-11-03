import * as z from 'zod/v4';
import type { AppMcpToolModuleProvider } from './tool-modules';
import { loggedToolResult } from './tool-modules';

export function createDebugToolModuleProvider(
  enabled: boolean,
  restart: (agentId: string, reason: string) => Promise<{ scheduled: boolean }>,
): AppMcpToolModuleProvider {
  return {
    id: 'debug',
    resolve: ({ agentId }) => enabled ? {
      id: 'debug',
      register(server) {
        server.registerTool('restart-backend', {
          description: 'Debug only: restart the backend only after the user explicitly requests or approves this restart in the conversation, including from a remote or mobile client. Ask in the conversation first if authorization is missing. No desktop confirmation is shown. The app stays open; active turns and this tool call may be interrupted. Returns scheduling, not completed restart.',
          inputSchema: { reason: z.string().trim().min(1).max(500).describe('Reason for the user-authorized restart.') },
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        }, ({ reason }) => loggedToolResult('restart-backend', { agentId }, () => restart(agentId, reason)));
      },
    } : undefined,
  };
}
