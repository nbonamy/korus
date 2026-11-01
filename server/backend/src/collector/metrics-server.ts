import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import type pg from "pg";
import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { metricsFilter, metricsSql } from "./metrics";

/** Separate read-only process, pool and operator gate. No ingestion or arbitrary
 * SQL route. The console proxy authenticates viewers and injects this private
 * credential server-side; it must never be shipped to browser assets.
 */
export function createMetricsServer(options: {
  pool: pg.Pool;
  accessToken: string;
  consoleOrigin: string;
  now?: () => number;
}) {
  const origin = new URL(options.consoleOrigin);
  if (
    !/^https?:$/.test(origin.protocol) ||
    origin.origin !== options.consoleOrigin ||
    options.accessToken.length < 32 ||
    options.accessToken.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(options.accessToken)
  )
    throw new Error("Invalid private metrics configuration.");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const expected = digest(`Bearer ${options.accessToken}`);
  let active = 0;
  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 5000,
      requestTimeout: 10000,
      keepAliveTimeout: 1000,
      connectionsCheckingInterval: 1000,
    },
    (req, res) => {
      const reply = (status: number, body: unknown) => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Connection: "close",
          Vary: "Origin",
          ...(status === 429 ? { "Retry-After": "1" } : {}),
          ...(req.headers.origin === options.consoleOrigin
            ? { "Access-Control-Allow-Origin": options.consoleOrigin }
            : {}),
        });
        res.end(JSON.stringify(body));
      };
      void (async () => {
        const url = new URL(req.url ?? "/", "http://internal.invalid");
        if (req.method !== "GET" || url.pathname !== "/v1/telemetry/metrics") {
          reply(404, { error: "not_found" });
          return;
        }
        if (
          !timingSafeEqual(digest(req.headers.authorization ?? ""), expected)
        ) {
          reply(401, { error: "unauthorized" });
          return;
        }
        if (
          req.headers.origin !== undefined &&
          req.headers.origin !== options.consoleOrigin
        ) {
          reply(403, { error: "forbidden" });
          return;
        }
        const filter = metricsFilter(
          url.searchParams,
          (options.now ?? Date.now)(),
        );
        if (!filter) {
          reply(400, { error: "invalid" });
          return;
        }
        if (active >= 4) {
          reply(429, { error: "limited" });
          return;
        }
        active++;
        try {
          // Read-only even when an operator accidentally supplies a privileged role.
          // A single statement provides snapshot consistency during replacements.
          const result = await options.pool.query<{
            metrics: TelemetryMetrics;
          }>(metricsSql, [
            filter.from,
            filter.to,
            filter.provider,
            filter.model,
            filter.groupServiceTiers ?? false,
            filter.timeZone ?? "UTC",
          ]);
          reply(200, result.rows[0]!.metrics);
        } finally {
          active--;
        }
      })()
        .catch(() => reply(503, { error: "unavailable" }))
        .finally(() => req.resume());
    },
  );
  server.maxHeadersCount = 32;
  server.maxConnections = 32;
  server.on("clientError", (_error, socket) =>
    socket.end(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    ),
  );
  return server;
}
