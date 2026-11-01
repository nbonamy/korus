import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import {
  installLocalMediaProtocol,
  localMediaScheme,
  LocalMediaRegistry,
  registerLocalMediaScheme,
  withRendererMediaUrls,
} from '../local-media';

describe('local media', () => {
  it('replaces file media URLs with stable opaque renderer URLs', () => {
    const registry = new LocalMediaRegistry(() => 'token-1');
    const source = {
      messages: [{
        parts: [{
          type: 'media',
          media: {
            url: `file:///Users/nbonamy/${product.homeDirectory}/codex-home/generated_images/thread/image.png`,
            mimeType: 'image/png',
          },
        }],
      }],
    };

    const first = withRendererMediaUrls(source, registry);
    const second = withRendererMediaUrls(source, registry);

    expect(first).toStrictEqual({
      messages: [{
        parts: [{
          type: 'media',
          media: {
            url: 'agent-workspace-media://generated/token-1',
            mimeType: 'image/png',
          },
        }],
      }],
    });
    expect(second).toStrictEqual(first);
    expect(JSON.stringify(first)).not.toContain('/Users/nbonamy');
  });

  it('leaves non-file media and unrelated values untouched', () => {
    const registry = new LocalMediaRegistry(() => 'unused');
    const source = {
      messages: [{
        parts: [
          { type: 'media', media: { url: 'data:image/png;base64,cG5n' } },
          { type: 'text', text: 'file:///tmp/not-media.png' },
        ],
      }],
    };

    expect(withRendererMediaUrls(source, registry)).toBe(source);
  });

  it('serves only registered opaque media URLs', async () => {
    const registry = new LocalMediaRegistry(() => 'token-1');
    const rendererUrl = registry.rendererUrl('file:///tmp/generated%20image.png');
    const handle = vi.fn();
    const fetchLocalFile = vi.fn(async () => new Response('png'));

    installLocalMediaProtocol(registry, { handle }, fetchLocalFile);

    expect(handle).toHaveBeenCalledWith(localMediaScheme, expect.any(Function));
    const handler = handle.mock.calls[0]?.[1] as (request: { url: string }) => Promise<Response> | Response;
    const response = await handler({ url: rendererUrl! });
    const missing = await handler({ url: 'agent-workspace-media://generated/not-registered' });

    expect(fetchLocalFile).toHaveBeenCalledWith('file:///tmp/generated%20image.png');
    expect(await response.text()).toBe('png');
    expect(missing.status).toBe(404);
    expect(fetchLocalFile).toHaveBeenCalledOnce();
  });

  it('registers the custom scheme before Electron becomes ready', () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerLocalMediaScheme({ registerSchemesAsPrivileged });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([{
      scheme: localMediaScheme,
      privileges: {
        standard: true,
        secure: true,
        bypassCSP: true,
        supportFetchAPI: true,
        stream: true,
      },
    }]);
  });
});
