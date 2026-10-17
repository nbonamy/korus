import type { CodexConversation, CodexSurface } from '@codex-app-sdk/backend';
import type { CodexSurfaceTurnStatus } from '@codex-app-sdk/core/surface';
import type { BackendImageGenerationInput, BackendImageGenerationResult } from '@workspace/core/backend-driver';
import { fileURLToPath } from 'node:url';
import { warnMain } from '../log';

/** Korus's internal image job; conversation execution and image projection stay SDK-owned. */
export class CodexImageGeneration {
  private readonly jobs = new Set<AbortController>();
  constructor(private readonly surface: CodexSurface) {}

  close(): void { for (const job of this.jobs) job.abort(new Error('Codex image generation was cancelled.')); }

  async generate(input: BackendImageGenerationInput, requestedSignal?: AbortSignal): Promise<BackendImageGenerationResult> {
    const job = new AbortController();
    this.jobs.add(job);
    const signal = AbortSignal.any([job.signal, AbortSignal.timeout(8 * 60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    let conversation: CodexConversation | undefined;
    let unsubscribe = () => {};
    let finished = false;
    let abort = () => {};
    try {
      signal.throwIfAborted();
      await this.surface.connect();
      const models = await this.surface.listModels({ includeHidden: false, forceReload: true });
      const luna = models.filter(model => /(?:^|[-_\s])luna(?:$|[-_\s])/i.test(model.model))
        .sort((a, b) => b.model.localeCompare(a.model, undefined, { numeric: true }))[0];
      if (!luna) throw new Error('No Luna model is available in the Codex model catalog.');
      signal.throwIfAborted();
      const created = await this.surface.createConversation({
        cwd: input.cwd, model: luna.model,
        ...(luna.supportedReasoningEfforts?.some(effort => effort.reasoningEffort === 'low') ? { reasoningEffort: 'low' } : {}),
        permissionMode: 'read-only', approvalMode: 'never',
        config: { 'features.image_generation': true },
        baseInstructions: 'Generate the requested raster image using the built-in image-generation tool. Preserve the requested subject, style, text and transparency. Do not substitute SVG or code. Do not perform unrelated work or edit project files. Finish after generating the image.',
        threadSource: 'image_generation_bridge',
      }, { mcpServers: [] });
      if (!created.activeConversationId) throw new Error('Codex did not create the internal image conversation.');
      conversation = this.surface.conversation(created.activeConversationId);
      signal.throwIfAborted();
      const statuses = new Map<string, CodexSurfaceTurnStatus>();
      let target: string | undefined;
      let resolve!: (status: CodexSurfaceTurnStatus) => void;
      let reject!: (error: unknown) => void;
      const completion = new Promise<CodexSurfaceTurnStatus>((done, failed) => { resolve = done; reject = failed; });
      // Provider notifications can arrive before sendMessage resolves.
      void completion.catch(() => {});
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      unsubscribe = conversation.onEvent(event => {
        if (event.type === 'turn.completed') {
          statuses.set(event.turnId, event.payload.status);
          if (event.turnId === target) resolve(event.payload.status);
        } else if (event.type === 'approval.requested' || event.type === 'clientRequest.requested') {
          job.abort(new Error('The internal image job requested an interactive approval or answer.'));
        } else if (event.type === 'turn.error' && !event.payload.willRetry) {
          job.abort(new Error(event.payload.error.message));
        }
      });
      const started = await conversation.sendMessage(input.prompt);
      signal.throwIfAborted();
      target = started.activeTurnId ?? started.turnIds.at(-1);
      if (!target) throw new Error('Codex did not start the image-generation turn.');
      const status = statuses.get(target) ?? started.turns.find(turn => turn.id === target && turn.status !== 'inProgress')?.status ?? await completion;
      if (status !== 'completed') throw new Error(`Codex image generation was ${status}.`);
      const messages = conversation.getSnapshot().messages.filter(message => message.role === 'assistant' && message.turnId === target);
      const generated = new Set(messages.flatMap(message => message.parts.flatMap(part =>
        part.type === 'tool' && part.title === 'image_generation' && part.status === 'completed' ? [part.id] : [])));
      const images: BackendImageGenerationResult['images'] = [];
      for (const message of messages) for (const part of message.parts) {
        if (part.type !== 'media' || !part.itemId || !generated.has(part.itemId)) continue;
        const data = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(part.media.url);
        if (data) images.push({ data: data[2]!, mimeType: data[1]! });
        else if (part.media.url.startsWith('file:') && part.media.mimeType) images.push({ path: fileURLToPath(part.media.url), mimeType: part.media.mimeType });
      }
      if (!images.length) throw new Error('Codex completed without generating an image.');
      finished = true;
      return { images };
    } finally {
      signal.removeEventListener('abort', abort);
      unsubscribe();
      this.jobs.delete(job);
      if (conversation) {
        if (!finished) await conversation.interrupt().catch(() => {});
        await this.surface.deleteConversation(conversation.id).catch(error => {
          warnMain('image-generation', 'conversation cleanup failed', { conversationId: conversation!.id, message: String(error) });
        });
        this.surface.forgetConversation(conversation.id);
      }
    }
  }
}
