import type { WorkProviderKind } from '@workspace/core/contracts';
import { workProviderDefinition, workProviderKinds } from '@workspace/core/work-providers';

export type HostedMcpServerId = WorkProviderKind;

export type HostedMcpCredentialProvider = {
  isHostedMcpConnected(provider: WorkProviderKind): boolean;
  hostedMcpAuthorizationHeader?(provider: WorkProviderKind, options?: { forceRefresh?: boolean }): Promise<string>;
  reportHostedMcpFailure?(provider: WorkProviderKind, status: number, authorization: string): Promise<void>;
  authorizationHeader(
    provider: WorkProviderKind,
    options?: { forceRefresh?: boolean },
  ): Promise<string>;
};

export type HostedMcpGatewayOptions = {
  credentials: HostedMcpCredentialProvider;
  fetch?: typeof fetch;
};

type HostedMcpServerDefinition = {
  id: HostedMcpServerId;
  provider: WorkProviderKind;
  url: string;
};

const hostedMcpServers: readonly HostedMcpServerDefinition[] = workProviderKinds.flatMap(provider => {
  const hosted = workProviderDefinition(provider).hostedMcp;
  return hosted ? [{ id: provider, provider, url: hosted.url }] : [];
});

const forwardedRequestHeaders = [
  'accept',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
] as const;

/**
 * Keeps hosted MCP transport and credentials inside daemon. Backend harnesses
 * connect to a loopback URL and never receive the provider access token.
 */
export class HostedMcpGateway {
  private readonly fetch: typeof fetch;
  private readonly credentials: HostedMcpCredentialProvider;

  constructor(options: HostedMcpGatewayOptions) {
    this.credentials = options.credentials;
    this.fetch = options.fetch ?? fetch;
  }

  enabledServerUrls(appMcpServerUrl: string): Partial<Record<HostedMcpServerId, string>> {
    return Object.fromEntries(
      hostedMcpServers
        .filter(({ provider }) => this.credentials.isHostedMcpConnected(provider))
        .map(({ id }) => [id, hostedMcpServerUrl(appMcpServerUrl, id)]),
    ) as Partial<Record<HostedMcpServerId, string>>;
  }

  hasServer(serverId: string): serverId is HostedMcpServerId {
    return hostedMcpServers.some(({ id }) => id === serverId);
  }

  async forward(
    serverId: HostedMcpServerId,
    input: { method: string; headers: Headers; body?: Uint8Array },
  ): Promise<Response> {
    const definition = hostedMcpServers.find(({ id }) => id === serverId);
    if (!definition) {
      throw new Error(`Unknown hosted MCP server: ${serverId}`);
    }

    const first = await this.request(definition, input, false);
    if (first.status !== 401) {
      return first;
    }

    await first.body?.cancel();
    return this.request(definition, input, true);
  }

  private async request(
    definition: HostedMcpServerDefinition,
    input: { method: string; headers: Headers; body?: Uint8Array },
    forceRefresh: boolean,
  ): Promise<Response> {
    if (!this.credentials.isHostedMcpConnected(definition.provider)) throw new Error('Hosted MCP is unavailable. Check integration permissions in Settings.');
    const headers = new Headers();
    for (const name of forwardedRequestHeaders) {
      const value = input.headers.get(name);
      if (value) headers.set(name, value);
    }
    const authorize = this.credentials.hostedMcpAuthorizationHeader?.bind(this.credentials) ?? this.credentials.authorizationHeader.bind(this.credentials);
    const authorization = await authorize(
      definition.provider,
      forceRefresh ? { forceRefresh: true } : undefined,
    );
    headers.set('authorization', authorization);
    if (!this.credentials.isHostedMcpConnected(definition.provider)) throw new Error('Hosted MCP is unavailable. Check integration permissions in Settings.');

    const response = await this.fetch(definition.url, {
      method: input.method,
      headers,
      ...(input.body ? { body: input.body } : {}),
      redirect: 'error',
    });
    if (response.status === 403) await this.credentials.reportHostedMcpFailure?.(definition.provider, response.status, authorization);
    return response;
  }
}

export function hostedMcpServerUrl(appMcpServerUrl: string, serverId: HostedMcpServerId): string {
  const url = new URL(appMcpServerUrl);
  url.pathname = `/mcp/providers/${serverId}`;
  url.search = '';
  return url.toString();
}
