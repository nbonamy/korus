import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createCodexSurface } from '@codex-app-sdk/backend';
import type { BackendImageGenerationResult } from '@workspace/core/backend-driver';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { appSurfaceOptions, BackendDriverRpc } from '../../driver-rpc';
import { CodexBackendDriver } from '../../codex/codex-driver';
import { CodexSurfaceAgentAdapter } from '../../codex/codex-surface-adapter';
import { ImageGenerationService } from '../../image-generation-service';
import { createImageGenerationToolModuleProvider } from '../image-generation-tools';
import { AppMcpService } from '../service';

// Opt-in: authenticated Codex, real Luna execution, and the caller's MCP endpoint.
// Retains a verifiable image in the repository's ignored development artifacts.
it.skipIf(process.env.KORUS_IMAGE_GENERATION_LIVE !== '1')('returns a native Luna image through the non-Codex MCP bridge', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'korus-image-live-'));
  const home = path.join(root, 'codex-home');
  const snapshot = createInitialSnapshot();
  const caller = snapshot.agents[0]!;
  caller.backend = 'claude';
  caller.backendSession = undefined;
  caller.folder = root;
  snapshot.general.providerHomes = { codex: { isolated: true, shareSkills: false, homePath: home } };
  const originalShared = process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
  process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON = '0';
  let driver: CodexBackendDriver | undefined;
  let mcp: AppMcpService | undefined;
  try {
    await mkdir(home, { mode: 0o700 });
    await copyFile(path.join(os.homedir(), '.korus', 'codex-home', 'auth.json'), path.join(home, 'auth.json'));
    const surface = createCodexSurface(appSurfaceOptions({ generalSettings: snapshot.general }));
    driver = new CodexBackendDriver(new CodexSurfaceAgentAdapter(surface));
    const rpc = new BackendDriverRpc(new Map([['codex', driver]]));
    const images = new ImageGenerationService({ snapshot, generatedImagesRoot: path.join(home, 'generated_images'), defaultCwd: root,
      generate: (agent, input, signal) => rpc.handle(backendMethods.driverImageGenerate, { agent, ...input }, { signal }) as Promise<BackendImageGenerationResult> });
    mcp = new AppMcpService({ snapshot, toolModuleProviders: [createImageGenerationToolModuleProvider(images)] });
    const url = await mcp.start();
    const response = await fetch(`${url}?agentId=${caller.id}`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'generate-image', arguments: {
        prompt: 'Generate one small square raster illustration of a blue flower with five petals on a white background. Use the built-in image-generation tool. No text.',
      } } }), signal: AbortSignal.timeout(9 * 60_000) });
    const result = (await response.json() as { result: { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[]; structuredContent?: { images: { path: string; mimeType: string }[] } } }).result;
    expect(result.isError, JSON.stringify(result.content.filter(part => part.type === 'text'))).toBe(false);
    const image = result.content.find(part => part.type === 'image')!;
    expect(image?.mimeType).toBe('image/png');
    const bytes = Buffer.from(image.data!, 'base64');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await readFile(result.structuredContent!.images[0]!.path)).toEqual(bytes);
    expect(caller.backend).toBe('claude');
    expect(caller.backendSession).toBeUndefined();
    expect(rpc.isBusy('codex')).toBe(false);
    const artifacts = path.resolve(import.meta.dirname, '../../../../.app-dev/image-generation');
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, 'luna-mcp.png'), bytes);
  } finally {
    await mcp?.stop();
    await driver?.close();
    if (originalShared === undefined) delete process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
    else process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON = originalShared;
    await rm(root, { recursive: true, force: true });
  }
}, 10 * 60_000);
