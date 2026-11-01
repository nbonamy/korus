import { product } from '@workspace/core/product';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { GlobalWorkItemQuery, WorkItemQuery, WorkProviderSettings } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { requireWorkProviderToken, type WorkProviderCredential, type WorkProviderDeviceAuthorization, type WorkProviderDeviceTokenResult, type WorkProviderDriver } from './types';
import { linearAssignedItems, linearGlobalItems, linearItems, linearSources } from './linear-backlog';

type Attempt = {
  id: string;
  state: string | null;
  verifier: string;
  clientId: string;
  callback: URL;
  server: Server;
  abort: AbortController;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  result: WorkProviderDeviceTokenResult;
};

/** Credentials and the short-lived loopback callback belong to daemon. */
export class LinearWorkProviderDriver implements WorkProviderDriver {
  readonly provider = 'linear' as const;
  private attempt?: Attempt;

  constructor(private readonly settings: () => WorkProviderSettings) {}

  configured(): boolean {
    return Boolean(this.settings().oauthClientId?.trim());
  }

  async startAuthorization(): Promise<WorkProviderDeviceAuthorization> {
    this.cancelAuthorization();
    const settings = this.settings();
    const clientId = settings.oauthClientId?.trim();
    if (!clientId) throw new Error('Linear OAuth is not configured for this build.');
    const callback = new URL('http://127.0.0.1:5173/api/auth/callback/linear');
    const attempt: Attempt = {
      id: randomBytes(32).toString('base64url'),
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
      clientId,
      callback,
      abort: new AbortController(),
      server: createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Referrer-Policy', 'no-referrer');
        let url: URL;
        try {
          url = new URL(request.url ?? '/', callback.origin);
        } catch {
          response.writeHead(400).end('Invalid callback URL.');
          return;
        }
        if (request.method !== 'GET' || request.headers.host !== callback.host || url.pathname !== callback.pathname) {
          response.writeHead(404).end('Not found.');
          return;
        }
        if (this.attempt !== attempt || !attempt.state || url.searchParams.get('state') !== attempt.state || Date.now() >= attempt.expiresAt) {
          response.writeHead(400).end(`Authorization expired or invalid. Start again in ${product.name}.`);
          return;
        }
        attempt.state = null; // Consume before any asynchronous exchange; replays cannot race it.
        void this.exchangeCallback(attempt, url).then(() => {
          response.writeHead(attempt.result.status === 'success' ? 200 : 400).end(
            attempt.result.status === 'success' ? `Authorization received. Return to ${product.name} to finish connecting.` : `Authorization failed or cancelled. Return to ${product.name} and try again.`,
          );
          this.closeListener(attempt);
        });
      }),
      expiresAt: Date.now() + 10 * 60_000,
      result: { status: 'pending' },
    };
    this.attempt = attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        attempt.server.once('error', reject);
        attempt.server.listen(Number(callback.port), callback.hostname, () => {
          attempt.server.removeListener('error', reject);
          resolve();
        });
      });
    } catch {
      if (this.attempt === attempt) this.cancelAuthorization();
      throw new Error('Cannot open the Linear callback port (5173). Close the application using that port and try again.');
    }
    if (this.attempt !== attempt) {
      this.closeListener(attempt);
      throw new Error('Linear authorization was cancelled.');
    }
    attempt.server.unref();
    attempt.timer = setTimeout(() => {
      attempt.state = null;
      attempt.abort.abort();
      attempt.result = { status: 'error', code: 'expired', message: `Linear authorization expired. Check that the browser runs on the same computer as ${product.name} and retry.` };
      this.closeListener(attempt);
    }, Math.max(0, attempt.expiresAt - Date.now()));
    attempt.timer.unref();
    const url = new URL('https://linear.app/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: callback.href, response_type: 'code',
      scope: 'read,write', state: attempt.state!,
      code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
      code_challenge_method: 'S256', actor: 'user', prompt: 'consent',
    }).toString();
    return { provider: 'linear', flow: 'browser', deviceCode: attempt.id, intervalSeconds: 1, verificationUri: url.href, expiresAt: new Date(attempt.expiresAt).toISOString() };
  }

  async pollAuthorization(id: string): Promise<WorkProviderDeviceTokenResult> {
    return this.attempt?.id === id ? this.attempt.result : { status: 'error', code: 'expired', message: 'Start Linear authorization again.' };
  }

  cancelAuthorization(): void {
    if (this.attempt) {
      this.attempt.state = null;
      this.attempt.abort.abort();
      this.attempt.verifier = '';
      this.closeListener(this.attempt);
      this.attempt = undefined;
    }
  }

  private closeListener(attempt: Attempt): void {
    if (attempt.timer) clearTimeout(attempt.timer);
    attempt.server.close();
  }

  private async exchangeCallback(attempt: Attempt, url: URL): Promise<void> {
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      attempt.result = { status: 'error', code: 'access_denied', message: 'Linear authorization was denied.' };
      return;
    }
    try {
      const token = await this.requestToken({ grant_type: 'authorization_code', client_id: attempt.clientId, redirect_uri: attempt.callback.href, code: url.searchParams.get('code')!, code_verifier: attempt.verifier }, attempt.abort.signal);
      if (this.attempt === attempt && Date.now() < attempt.expiresAt) attempt.result = { status: 'success', token };
    } catch {
      attempt.result = { status: 'error', code: 'unavailable', message: 'Linear token exchange failed. Please reconnect.' };
    } finally {
      attempt.verifier = '';
    }
  }

  private async requestToken(parameters: Record<string, string>, signal?: AbortSignal): Promise<Omit<WorkProviderToken, 'provider' | 'connectedAt' | 'accountLabel'>> {
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Linear authorization failed. Reconnect in Settings.');
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.token_type !== 'Bearer') {
      throw new Error('Linear returned an invalid OAuth token.');
    }
    return { accessToken: value.access_token, refreshToken: value.refresh_token, tokenType: 'Bearer', expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString(), ...(typeof value.scope === 'string' ? { scope: value.scope } : {}) };
  }

  async refreshToken(token: WorkProviderToken): Promise<WorkProviderToken> {
    const clientId = this.settings().oauthClientId?.trim();
    if (!clientId || !token.refreshToken) throw new Error('Reconnect Linear in Settings.');
    return { ...token, ...await this.requestToken({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token.refreshToken }) };
  }

  async currentAccountLabel(credential: WorkProviderCredential): Promise<string> {
    const token = requireWorkProviderToken(credential);
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { name organization { name } } }' }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('Could not verify the Linear account. Reconnect in Settings.');
    const value = await response.json() as { errors?: unknown; data?: { viewer?: { name?: string; organization?: { name?: string } } } };
    const viewer = value.data?.viewer;
    if (value.errors || typeof viewer?.name !== 'string' || !viewer.name) throw new Error('Could not verify the Linear account.');
    return viewer.organization?.name ? `${viewer.name} · ${viewer.organization.name}` : viewer.name;
  }

  listSources(credential: WorkProviderCredential) {
    return linearSources(requireWorkProviderToken(credential));
  }
  listGlobalItems(credential: WorkProviderCredential, query?: GlobalWorkItemQuery) {
    return linearGlobalItems(requireWorkProviderToken(credential), query);
  }
  listItems(credential: WorkProviderCredential, sourceId: string, query?: WorkItemQuery) {
    return linearItems(requireWorkProviderToken(credential), sourceId, query);
  }
  listAssignedItems(credential: WorkProviderCredential) {
    return linearAssignedItems(requireWorkProviderToken(credential));
  }
}
