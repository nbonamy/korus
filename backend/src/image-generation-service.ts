import type { BackendImageGenerationInput, BackendImageGenerationResult } from '@workspace/core/backend-driver';
import type { Agent, AppSnapshot, BackendSkillSummary } from '@workspace/core/contracts';
import { readBundledSkill } from './bundled-skills/catalog';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' } as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function imageGenerationSkill(snapshot: AppSnapshot, agentId: string): BackendSkillSummary | undefined {
  const agent = snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent || agent.backend === 'codex' || snapshot.general.providerEnabled?.codex === false || agent.remoteConnectionId) return;
  const { description } = readBundledSkill('korus-imagegen', { toolModules: ['image-generation'] });
  return { name: 'imagegen', displayName: 'Image Gen', description,
    shortDescription: 'Generate or edit images for websites, games, and more',
    path: 'korus:skill/korus-imagegen', scope: 'system', enabled: true };
}

export class ImageGenerationService {
  constructor(private readonly options: {
    snapshot: AppSnapshot;
    generatedImagesRoot: string;
    defaultCwd: string;
    generate: (agent: Agent, input: BackendImageGenerationInput, signal?: AbortSignal) => Promise<BackendImageGenerationResult>;
  }) {}

  available(agentId: string): boolean {
    return Boolean(imageGenerationSkill(this.options.snapshot, agentId));
  }

  async generate(agentId: string, prompt: string, signal?: AbortSignal) {
    if (!this.available(agentId)) throw new Error('The image bridge is available to local non-Codex agents with Codex enabled.');
    const caller = this.options.snapshot.agents.find(agent => agent.id === agentId)!;
    const cwd = caller.folder?.startsWith('~/') ? path.join(os.homedir(), caller.folder.slice(2)) : caller.folder || this.options.defaultCwd;
    const result = await this.options.generate({ ...caller, backend: 'codex', backendSession: undefined, backendDefaults: undefined }, { prompt, cwd }, signal);
    signal?.throwIfAborted();
    if (!result.images.length || result.images.length > 4) throw new Error('Codex must return one to four images.');
    await mkdir(this.options.generatedImagesRoot, { recursive: true });
    const root = await realpath(this.options.generatedImagesRoot);
    let total = 0;
    const buffers: { buffer: Buffer; mimeType: keyof typeof extensions }[] = [];
    for (const image of result.images) {
      const mimeType = image.mimeType as keyof typeof extensions;
      if (!Object.hasOwn(extensions, mimeType)) throw new Error('Generated images must be PNG, JPEG, WebP or GIF.');
      let buffer: Buffer;
      if (image.data !== undefined) {
        if (image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[a-z0-9+/]+={0,2}$/i.test(image.data)) throw new Error('Invalid or oversized generated image data.');
        buffer = Buffer.from(image.data, 'base64');
      } else {
        const file = await realpath(image.path ?? '');
        const relative = path.relative(root, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Image must be inside the generated-images folder.');
        const details = await stat(file);
        if (!details.isFile() || details.size > MAX_IMAGE_BYTES) throw new Error('Invalid or oversized generated image file.');
        buffer = await readFile(file);
      }
      total += buffer.length;
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('Generated images exceed the 20 MiB response limit or contain an empty image.');
      buffers.push({ buffer, mimeType });
    }
    const images: { path: string; data: string; mimeType: string }[] = [];
    try {
      for (const { buffer, mimeType } of buffers) {
        signal?.throwIfAborted();
        const file = path.resolve(this.options.generatedImagesRoot, `${randomUUID()}${extensions[mimeType]}`);
        await writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
        images.push({ path: file, mimeType, data: buffer.toString('base64') });
      }
      signal?.throwIfAborted();
      return { images };
    } catch (error) {
      await Promise.all(images.map(image => unlink(image.path).catch(() => {})));
      throw error;
    }
  }
}
