import * as z from 'zod/v4';
import { product } from '@workspace/core/product';
import { readBundledSkill } from '../bundled-skills/catalog';
import type { AppMcpAgentCoordinator } from './agent-coordinator';
import { loggedToolResult, type AppMcpToolModuleProvider, type AppMcpToolRequest } from './tool-modules';

export function createSkillToolModuleProvider(
  coordinator: AppMcpAgentCoordinator,
  availableModules: (request: AppMcpToolRequest) => readonly string[],
): AppMcpToolModuleProvider {
  return {
    id: 'bundled-skills',
    resolve: request => ({
      id: 'bundled-skills',
      register: server => server.registerTool('read-skill', {
        description: `Load a bundled ${product.name} skill by its catalog name before using that capability. Returns instructions, not authorization to act. Only skills available to this caller are readable; paths and personal skills are not accepted.`,
        inputSchema: { name: z.string().min(1).max(100) },
        annotations: { readOnlyHint: true, openWorldHint: false },
      }, async ({ name }) => {
        let markdown = '';
        const result = await loggedToolResult('read-skill', { agentId: request.agentId, name }, () => {
          const mission = coordinator.missionContext(request.agentId);
          const definition = readBundledSkill(name, { toolModules: availableModules(request), missionStage: mission?.stage });
          markdown = definition.markdown;
          return { name: definition.name, loaded: true };
        });
        if (!result.isError) result.content = [{ type: 'text', text: markdown }];
        return result;
      }),
    }),
  };
}
