import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { BackendDriverRpc } from '../../driver-rpc';
import { ImageGenerationService } from '../../image-generation-service';
import { createImageGenerationToolModuleProvider } from '../image-generation-tools';
import { AppMcpService } from '../service';

describe('non-Codex image generation over MCP', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
  async function setup() {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'image-bridge-'));
    cleanups.push(() => rm(folder, { recursive: true, force: true }));
    const root = path.join(folder, 'generated_images');
    await mkdir(root);
    const snapshot = createInitialSnapshot();
    snapshot.agents[0] = { ...snapshot.agents[0]!, backend: 'claude', folder, backendSession: { kind: 'claude', sessionId: 'original', transport: 'stdio' } };
    snapshot.agents[1] = { ...snapshot.agents[1]!, backend: 'codex' };
    const generateImage = vi.fn<NonNullable<AgentBackendDriver['generateImage']>>().mockResolvedValue({ images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }] });
    const driver: AgentBackendDriver = {
      backend: 'codex', generateImage, getRuntimeStatus: vi.fn(), getCapabilities: vi.fn(), sendPrompt: vi.fn(),
      interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: vi.fn(),
    };
    const connected = vi.fn();
    const rpc = new BackendDriverRpc(new Map([['codex', driver]]), undefined, connected);
    const images = new ImageGenerationService({ snapshot, generatedImagesRoot: root, defaultCwd: folder,
      generate: (agent, input, signal) => rpc.handle(backendMethods.driverImageGenerate, { agent, ...input }, { signal }) as ReturnType<NonNullable<AgentBackendDriver['generateImage']>> });
    const service = new AppMcpService({ snapshot, toolModuleProviders: [createImageGenerationToolModuleProvider(images)] });
    cleanups.push(() => service.stop());
    const url = await service.start();
    const request = async (method: string, params: unknown, agentId = snapshot.agents[0]!.id) => {
      const response = await fetch(`${url}?agentId=${agentId}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return (await response.json() as { result: {
        tools: { name: string }[]; isError?: boolean;
        content: { type: string; text?: string; data?: string; mimeType?: string }[];
        structuredContent: { success: boolean; images: { path: string; mimeType: string }[]; name?: string; loaded?: boolean; markdown?: string };
      } }).result;
    };
    const call = (input: unknown) => request('tools/call', { name: 'generate-image', arguments: input });
    return { folder, root, snapshot, generateImage, connected, rpc, images, request, call, url };
  }

  it('advertises only to non-Codex agents, invokes the Codex driver and returns an image with a unique saved path', async () => {
    const f = await setup();
    const conversations = () => f.snapshot.agents.map(({ id, backend, backendSession, backendDefaults, folder }) => ({ id, backend, backendSession, backendDefaults, folder }));
    const before = structuredClone(conversations());
    expect((await f.request('tools/list', {})).tools.map((tool: { name: string }) => tool.name)).toContain('generate-image');
    expect((await f.request('tools/list', {}, f.snapshot.agents[1]!.id)).tools.map((tool: { name: string }) => tool.name)).not.toContain('generate-image');
    const readSkill = (agentId = f.snapshot.agents[0]!.id) => f.request('tools/call', { name: 'read-skill', arguments: { name: 'korus-imagegen' } }, agentId);
    const skill = await readSkill();
    expect(skill.isError).toBe(false);
    expect(skill.structuredContent).toMatchObject({ name: 'korus-imagegen', loaded: true, markdown: expect.stringContaining('generate-image') });
    expect(skill.content).toEqual([{ type: 'text', text: skill.structuredContent.markdown }]);
    expect((await readSkill(f.snapshot.agents[1]!.id)).isError).toBe(true);
    const result = await f.call({ prompt: 'A transparent flower' });
    expect(result.isError).toBe(false);
    expect(result.content).toContainEqual({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' });
    expect(result.structuredContent).toStrictEqual({ success: true, images: [{ path: expect.any(String), mimeType: 'image/png' }] });
    const file = result.structuredContent.images[0].path;
    expect(result.content[0].text).toContain(`![Generated image](<${file}>)`);
    expect(path.dirname(file)).toBe(f.root);
    expect(await readFile(file, 'utf8')).toBe('image');
    expect(f.connected).toHaveBeenCalledWith('codex');
    expect(f.generateImage).toHaveBeenCalledWith(expect.objectContaining({ id: f.snapshot.agents[0]!.id, backend: 'codex', backendSession: undefined }),
      { cwd: f.folder, prompt: 'A transparent flower' }, expect.any(AbortSignal));
    const next = await f.call({ prompt: 'Another flower' });
    expect(next.structuredContent.images[0].path).not.toBe(file);
    expect(conversations()).toStrictEqual(before);
    f.snapshot.general.providerEnabled = { codex: false };
    expect((await f.request('tools/list', {})).tools.map((tool: { name: string }) => tool.name)).not.toContain('generate-image');
    expect((await readSkill()).isError).toBe(true);
  });

  it('rejects invalid arguments and failed or empty generations without creating image files', async () => {
    const f = await setup();
    for (const input of [{ prompt: '' }, { prompt: 'Flower', model: 'other' }]) expect((await f.call(input)).isError).toBe(true);
    expect(f.generateImage).not.toHaveBeenCalled();
    f.generateImage.mockRejectedValueOnce(new Error('Codex is signed out'));
    expect((await f.call({ prompt: 'Flower' })).content[0].text).toContain('signed out');
    f.generateImage.mockResolvedValueOnce({ images: [] });
    expect((await f.call({ prompt: 'Flower' })).isError).toBe(true);
    expect(await readdir(f.root)).toStrictEqual([]);
  });

  it('allows authoritative file results only inside the generated-images root, including through symlinks', async () => {
    const f = await setup();
    const outside = path.join(f.folder, 'private.png');
    await writeFile(outside, 'private');
    const link = path.join(f.root, 'escape.png');
    await symlink(outside, link);
    for (const file of [outside, link]) {
      f.generateImage.mockResolvedValueOnce({ images: [{ path: file, mimeType: 'image/png' }] });
      const result = await f.call({ prompt: 'Flower' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('generated-images');
    }
    const valid = path.join(f.root, 'provider.png');
    await writeFile(valid, 'image');
    f.generateImage.mockResolvedValueOnce({ images: [{ path: valid, mimeType: 'image/png' }] });
    expect((await f.call({ prompt: 'Flower' })).content).toContainEqual({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' });
    expect(await readFile(outside, 'utf8')).toBe('private');
  });

  it('bounds image content before saving or returning it', async () => {
    const f = await setup();
    const large = Buffer.alloc(7 * 1024 * 1024).toString('base64');
    const image = { data: 'aW1hZ2U=', mimeType: 'image/png' };
    for (const images of [
      [{ ...image, data: 'invalid base64' }], [{ ...image, mimeType: 'text/html' }],
      Array.from({ length: 5 }, () => image),
      [{ ...image, data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }],
      Array.from({ length: 3 }, () => ({ ...image, data: large })),
    ]) {
      f.generateImage.mockResolvedValueOnce({ images });
      const result = await f.call({ prompt: 'Flower' });
      expect(result.isError).toBe(true);
      expect(result.content.some(item => item.type === 'image')).toBe(false);
      expect(await readdir(f.root)).toStrictEqual([]);
    }
  });

  it('cancels the Codex operation when the MCP caller disconnects', async () => {
    const f = await setup();
    f.generateImage.mockImplementationOnce(async (_agent, _input, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));
    const controller = new AbortController();
    const response = fetch(`${f.url}?agentId=${f.snapshot.agents[0]!.id}`, { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate-image', arguments: { prompt: 'Flower' } } }) });
    await vi.waitFor(() => expect(f.generateImage).toHaveBeenCalledOnce());
    expect(f.rpc.isBusy('codex')).toBe(true);
    controller.abort();
    await expect(response).rejects.toThrow();
    await vi.waitFor(() => expect(f.rpc.isBusy('codex')).toBe(false));
    expect(await readdir(f.root)).toStrictEqual([]);
  });
});
