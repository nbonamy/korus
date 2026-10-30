import { conversationImageInput, readEmbeddedConversationImage } from '@workspace/core/conversation-images';
import { provideCodexHostCapabilities, useCodexHostCapabilities } from '@codex-app-sdk/vue';
import { appApi } from '../platform-api';

/** Keep attachment capabilities native; read conversation file images on their owning host. */
export function provideConversationImagePreviews(agentId: () => string | undefined): void {
  const host = useCodexHostCapabilities();
  if (!host) return;
  provideCodexHostCapabilities({
    ...host,
    async readImagePreview(reference) {
      const owner = agentId(); const api = appApi;
      if (owner && api && conversationImageInput(reference)) {
        const image = await readEmbeddedConversationImage(reference, input => api.readConversationContent(owner, input));
        return owner === agentId() ? image : null;
      }
      try {
        const preview = await host.readImagePreview?.(reference);
        if (preview) return preview;
      } catch { /* A project file is not a native attachment capability. */ }
      const filePath = localImagePath(reference);
      if (!owner || !filePath || !appApi) return null;
      const preview = await appApi.previewAgentFile(owner, filePath);
      return preview.kind === 'image' ? preview.dataUrl ?? null : null;
    },
  });
}

function localImagePath(reference: string): string | null {
  reference = reference.trim();
  if (reference.startsWith('<') && reference.endsWith('>')) reference = reference.slice(1, -1);
  if (/^[a-z]:[\\/]/i.test(reference)) return reference;
  if (!/^[a-z][a-z\d+.-]*:/i.test(reference)) return reference;
  try {
    const url = new URL(reference);
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null;
    const filePath = decodeURIComponent(url.pathname);
    return /^\/[a-z]:\//i.test(filePath) ? filePath.slice(1) : filePath;
  } catch { return null; }
}
