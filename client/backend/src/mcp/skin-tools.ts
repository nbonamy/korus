import * as z from 'zod/v4';
import { skinNamePattern, type SkinControlInput, type SkinControlResult } from '@workspace/core/custom-themes';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createSkinToolModuleProvider(setSkin: (agentId: string, input: SkinControlInput) => Promise<SkinControlResult>): AppMcpToolModuleProvider {
  return {
    id: 'skins',
    resolve: ({ agentId }) => ({
      id: 'skins',
      register: server => server.registerTool('set-skin', {
        description: 'Apply, reload or disable a custom skin on the connected desktop client. Load korus-skin with read-skill before authoring a skin. A definition saves/replaces a named JSON source; name alone rereads that file even when already active. name:null disables without deleting sources or changing the chosen palette/mode. Returns saved source path and small metadata, not CSS. This changes client appearance, not the agent runtime or other clients.',
        inputSchema: z.strictObject({
          name: z.string().regex(skinNamePattern).nullable().describe('Saved source name: 1–64 lowercase letters, digits or hyphens, beginning with a letter/digit. null disables the active skin.'),
          definition: z.record(z.string(), z.unknown()).optional().describe('T3 v1 skin JSON to save and apply. Omit to reload the saved file. Keep the entire request below the MCP 1 MiB body limit.'),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }, input => loggedToolResult('set-skin', { agentId, name: input.name }, () => setSkin(agentId, input))),
    }),
  };
}
