import type { AppSnapshot } from '@workspace/core/contracts';
import * as z from 'zod/v4';
import type { CreatedProject } from '../projects/project-creation-service';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createQuickChatProjectToolModuleProvider(options: {
  snapshot: AppSnapshot;
  createProject: (agentId: string, name: string, prompt: string, backend?: 'codex' | 'claude' | 'antigravity') => Promise<CreatedProject>;
}): AppMcpToolModuleProvider {
  return {
    id: 'quick-chat-project',
    resolve: ({ agentId }) => {
      if (options.snapshot.agents.find(agent => agent.id === agentId)?.sessionKind !== 'quickChat') return undefined;
      return {
        id: 'quick-chat-project',
        register: server => {
          server.registerTool('create-project', {
            description: 'Create a project folder and agent only on explicit request. Read korus-delegation first. Uses the configured source folder without initializing Git; preserves this Quick Chat.',
            inputSchema: {
              backend: z.enum(['codex', 'claude', 'antigravity']).optional().describe('Coding backend; defaults to this Quick Chat’s backend.'),
              name: z.string().trim().min(1).describe('A single folder name for the new project.'),
              prompt: z.string().trim().min(1).describe('Self-contained first prompt for the new project agent, summarizing the agreed outcome and relevant decisions.'),
            },
          }, ({ name, prompt, backend }) => loggedToolResult('create-project', {
            agentId,
            name,
            promptLength: prompt.length,
          }, async () => {
            const created = await options.createProject(agentId, name, prompt, backend);
            return {
              success: true,
              agentId: created.agent.id,
              agentName: created.agent.name ?? created.repository.name,
              folder: created.repository.path,
              promptSubmitted: created.promptSubmitted,
              message: `Created ${created.repository.name} and started its project agent.`,
            };
          }));
        },
      };
    },
  };
}
