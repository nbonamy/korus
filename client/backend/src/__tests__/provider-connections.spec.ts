import { describe, expect, it, vi } from 'vitest';
import { ProviderConnections } from '../provider-connections';
const auth = (connected: boolean) => ({ kind: 'claude' as const, connected, state: { loggedIn: connected } });

describe('host engine connections', () => {
  it('detects once and serves cached status without shell or auth work until an explicit refresh', async () => {
    const detect = vi.fn(() => [{ backend: 'claude' as const, installed: true, homePath: '/claude' }]);
    const authenticate = vi.fn().mockResolvedValue(auth(true));
    const connections = new ProviderConnections({ detect, authenticate, changed: vi.fn() });
    await connections.refresh();
    authenticate.mockResolvedValue(auth(false));
    for (let count = 0; count < 5; count++) {
      expect((await connections.refresh())[0]?.connected).toBe(true);
      expect(connections.list()[0]?.authentication).toEqual(auth(true));
    }
    expect(detect).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledTimes(1);
    connections.invalidate('claude');
    expect((await connections.refresh())[0]?.connected).toBe(false);
    expect(detect).toHaveBeenCalledTimes(2);
  });
  it('re-checks only disconnected engines on demand', async () => {
    const authenticate = vi.fn().mockResolvedValue(auth(false));
    const connections = new ProviderConnections({
      detect: () => [{ backend: 'claude', installed: true, homePath: '/claude' }, { backend: 'codex', installed: true, homePath: '/codex' }], authenticate, changed: vi.fn(),
    });
    await connections.refresh();
    connections.observe('codex', true);
    authenticate.mockClear();
    authenticate.mockResolvedValue(auth(true));
    await connections.refreshDisconnected('claude');
    expect(authenticate.mock.calls).toStrictEqual([['claude']]);
    expect(connections.list().find(item => item.backend === 'claude')?.connected).toBe(true);
    authenticate.mockClear();
    await connections.refreshDisconnected();
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('skips absent engines and shares concurrent authentication probes', async () => {
    const authenticate = vi.fn(async () => auth(true));
    const connections = new ProviderConnections({
      detect: () => [
        { backend: 'codex', installed: false, homePath: '/codex' },
        { backend: 'claude', installed: true, homePath: '/claude' },
      ], authenticate, changed: vi.fn(),
    });
    await Promise.all([connections.refresh(), connections.refresh()]);
    expect(authenticate.mock.calls).toStrictEqual([['claude']]);
    expect(connections.list()).toStrictEqual([
      { backend: 'codex', installed: false, connected: false, checking: false, enabled: true },
      { backend: 'claude', installed: true, connected: true, checking: false, enabled: true, authentication: auth(true) },
    ]);
  });

  it('reports a safe startup probe error, then accepts an explicit authentication result', async () => {
    const authenticate = vi.fn().mockRejectedValueOnce(new Error('secret'));
    const connections = new ProviderConnections({
      detect: () => [{ backend: 'claude', installed: true, homePath: '/claude' }], authenticate, changed: vi.fn(),
    });
    expect((await connections.refresh())[0]).toMatchObject({ connected: false, checking: false, error: expect.not.stringContaining('secret') });
    connections.observe('claude', true);
    expect(connections.list()[0]).toStrictEqual({ backend: 'claude', installed: true, connected: true, checking: false, enabled: true });
    connections.observe('claude', false);
    expect(connections.list()[0]?.connected).toBe(false);
  });

  it('rejects an old home probe after a new home has been checked', async () => {
    let homePath = '/old';
    let finish!: (value: ReturnType<typeof auth>) => void;
    const authenticate = vi.fn().mockImplementationOnce(() => new Promise<ReturnType<typeof auth>>(resolve => { finish = resolve; })).mockResolvedValueOnce(auth(false));
    const connections = new ProviderConnections({
      detect: () => [{ backend: 'claude', installed: true, homePath }], authenticate, changed: vi.fn(),
    });
    const old = connections.refresh();
    await Promise.resolve();
    homePath = '/new';
    connections.invalidate('claude');
    await connections.refresh();
    finish(auth(true));
    await old;
    expect(connections.list()[0]?.connected).toBe(false);
  });
});
