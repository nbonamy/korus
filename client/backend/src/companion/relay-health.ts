import { createServer } from 'node:http';
import type { Libp2p } from '@libp2p/interface';
/** Container-only readiness. No peer IDs, app data, metrics labels or control API. */
export async function startRelayHealth(relay: Pick<Libp2p, 'status'>, port: number) {
  const server = createServer({ maxHeaderSize: 4096, requestTimeout: 3000, headersTimeout: 3000 }, (request, response) => {
    if (request.method !== 'GET' || request.url !== '/healthz') { response.writeHead(404); response.end(); return; }
    const ok = relay.status === 'started';
    response.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok }));
  });
  server.maxConnections = 4;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
