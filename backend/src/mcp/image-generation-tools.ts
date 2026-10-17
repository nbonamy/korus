import * as z from 'zod/v4';
import type { ImageGenerationService } from '../image-generation-service';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createImageGenerationToolModuleProvider(images: ImageGenerationService): AppMcpToolModuleProvider {
  return {
    id: 'image-generation',
    resolve: ({ agentId }) => images.available(agentId) ? {
      id: 'image-generation',
      register: server => server.registerTool('generate-image', {
        description: 'Generate images from a prompt. First load korus-imagegen with read-skill for inline display and optional saving instructions. Returns image content, saved file paths and Markdown for embedding the result in your response (up to four images, 10 MiB each and 20 MiB total). Prompt is required, at most 32,000 characters. Example: {"prompt":"A blue flower on a transparent background"}.',
        inputSchema: z.strictObject({ prompt: z.string().trim().min(1).max(32_000) }),
      }, async ({ prompt }, extra) => {
        let generated: Awaited<ReturnType<ImageGenerationService['generate']>> | undefined;
        const result = await loggedToolResult('generate-image', { agentId, promptLength: prompt.length }, async () => {
          generated = await images.generate(agentId, prompt, extra.signal);
          return { success: true, images: generated.images.map(({ path, mimeType }) => ({ path, mimeType })) };
        });
        if (generated && !result.isError) {
          result.content = [
            { type: 'text', text: `Embed the selected image inline in your response using this Markdown outside a code fence:\n\n${generated.images.map(image => `![Generated image](<${image.path}>)`).join('\n\n')}` },
            ...generated.images.map(({ data, mimeType }) => ({ type: 'image' as const, data, mimeType })),
          ];
        }
        return result;
      }),
    } : undefined,
  };
}
