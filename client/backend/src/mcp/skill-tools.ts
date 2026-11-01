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
        description: `Read a bundled ${product.name} procedure before using that capability. The full Markdown is returned in text content and structuredContent.markdown, not injected separately. Reading grants no authorization. Only names available to this caller are accepted, not paths or personal skills. Example: {"name":"korus-reviewer"} in a review session.`,
        inputSchema: { name: z.string().min(1).max(100) },
        annotations: { readOnlyHint: true, openWorldHint: false },
      }, async ({ name }) => {
        let markdown = '';
        const result = await loggedToolResult('read-skill', { agentId: request.agentId, name }, () => {
          const mission = coordinator.missionContext(request.agentId);
          const definition = readBundledSkill(name, { toolModules: availableModules(request), missionStage: mission?.stage });
          markdown = definition.markdown;
          return { name: definition.name, loaded: true, markdown };
        });
        if (!result.isError) result.content = [{ type: 'text', text: markdown }];
        return result;
      }),
    }),
  };
}
