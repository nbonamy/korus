import { CodexElectronAttachmentRegistry } from '@codex-app-sdk/electron';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const localMediaScheme = 'agent-workspace-media';

type SchemeRegistrar = {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string;
    privileges: {
      standard: boolean;
      secure: boolean;
      bypassCSP: boolean;
      supportFetchAPI: boolean;
      stream: boolean;
    };
  }>): void;
};

type ProtocolHandler = {
  handle(scheme: string, handler: (request: { url: string }) => Response | Promise<Response>): void;
};

export class LocalMediaRegistry {
  private readonly pathsByToken = new Map<string, string>();
  private readonly tokensByPath = new Map<string, string>();

  constructor(private readonly createToken: () => string = randomUUID) {}

  rendererUrl(sourceUrl: string): string | null {
    let filePath: string;
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== 'file:') return null;
      filePath = fileURLToPath(parsed);
    } catch {
      return null;
    }

    let token = this.tokensByPath.get(filePath);
    if (!token) {
      token = this.createToken();
      this.tokensByPath.set(filePath, token);
      this.pathsByToken.set(token, filePath);
    }
    return `${localMediaScheme}://generated/${encodeURIComponent(token)}`;
  }

  resolve(rendererUrl: string): string | null {
    try {
      const parsed = new URL(rendererUrl);
      if (parsed.protocol !== `${localMediaScheme}:` || parsed.hostname !== 'generated') return null;
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length !== 1 || parsed.search || parsed.hash) return null;
      return this.pathsByToken.get(decodeURIComponent(segments[0]!)) ?? null;
    } catch {
      return null;
    }
  }
}

/** Resolve only media capabilities issued by this main process; prompt attachment
 * admission continues to use the SDK registry's separate resolve() method. */
export class LocalMediaAttachmentRegistry extends CodexElectronAttachmentRegistry {
  constructor(private readonly media: LocalMediaRegistry) { super(); }
  override path(reference: string): string {
    return this.media.resolve(reference) ?? super.path(reference);
  }
}

export function registerLocalMediaScheme(registrar: SchemeRegistrar): void {
  registrar.registerSchemesAsPrivileged([{
    scheme: localMediaScheme,
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      stream: true,
    },
  }]);
}

export function installLocalMediaProtocol(
  registry: LocalMediaRegistry,
  protocol: ProtocolHandler,
  fetchLocalFile: (url: string) => Promise<Response>,
): void {
  protocol.handle(localMediaScheme, (request) => {
    const filePath = registry.resolve(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    return fetchLocalFile(pathToFileURL(filePath).href);
  });
}

export function withRendererMediaUrls<Value>(value: Value, registry: LocalMediaRegistry): Value {
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((entry) => {
      const rewritten = withRendererMediaUrls(entry, registry);
      changed ||= rewritten !== entry;
      return rewritten;
    });
    return (changed ? result : value) as Value;
  }
  if (!isRecord(value)) return value;

  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const rewritten = withRendererMediaUrls(entry, registry);
    changed ||= rewritten !== entry;
    result[key] = rewritten;
  }

  const candidate = changed ? result : value;
  if (candidate.type !== 'media' || !isRecord(candidate.media) || typeof candidate.media.url !== 'string') {
    return candidate as Value;
  }
  const rendererUrl = registry.rendererUrl(candidate.media.url);
  if (!rendererUrl) return candidate as Value;
  return {
    ...candidate,
    media: {
      ...candidate.media,
      url: rendererUrl,
    },
  } as Value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
