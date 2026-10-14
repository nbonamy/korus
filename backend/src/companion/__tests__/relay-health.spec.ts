import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { startRelayHealth } from '../relay-health';
import type { Libp2p } from '@libp2p/interface';
it('reports readiness without exposing peer/control data and marks a stopped relay unavailable', async () => {
  const relay: Pick<Libp2p, 'status'> = { status: 'started' };
  const server = await startRelayHealth(relay, 0);
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ready = await fetch(`${url}/healthz`); expect(ready.status).toBe(200); expect(await ready.json()).toEqual({ ok: true });
    relay.status = 'stopped';
    expect((await fetch(`${url}/healthz`)).status).toBe(503);
    expect((await fetch(`${url}/control`, { method: 'POST' })).status).toBe(404);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
