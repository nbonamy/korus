import {
  createServer as httpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as httpsServer } from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isTelemetryReport, telemetryLimits } from "@workspace/core/telemetry";
import {
  AggregateStore,
  operatorDimensions,
  type OperatorQuery,
} from "./telemetry/aggregate-store";
import { operatorPage, operatorScript } from "../web/operator-page";
export type ApiServerConfig = {
  database: string;
  operatorToken: string;
  host: string;
  port: number;
  tls?: { key: Buffer; cert: Buffer };
  synthetic?: boolean;
  /** Plaintext is allowed only on loopback behind the TLS-terminating owned proxy. */
  reverseProxy?: boolean;
  minimumReports?: number;
};
export async function startApiServer(
  config: ApiServerConfig,
): Promise<{ url: string; close(): Promise<void> }> {
  if (
    config.operatorToken.length < 32 ||
    (!config.tls &&
      !(
        (config.synthetic || config.reverseProxy) &&
        config.host === "127.0.0.1"
      ))
  )
    throw new Error("TLS and operator authentication are required.");
  if (
    config.minimumReports !== undefined &&
    (!Number.isSafeInteger(config.minimumReports) ||
      config.minimumReports < 10 ||
      config.minimumReports > 1000)
  )
    throw new Error("Invalid release threshold.");
  const store = new AggregateStore(
    config.database,
    Date.now,
    config.minimumReports ?? 10,
  );
  store.cleanup();
  const secret = createHash("sha256").update(config.operatorToken).digest();
  const rate = new Map<string, { until: number; requests: number }>();
  let active = 0;
  const audit = {
    operatorReads: 0,
    authorizationDenied: 0,
    rejectedReports: 0,
    acceptedReports: 0,
    duplicateReports: 0,
    retentionHealthy: true,
    lastRetentionAt: new Date().toISOString(),
  };
  const authenticated = (request: IncomingMessage): boolean => {
    const authorization = request.headers.authorization ?? "";
    const provided = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : authorization.startsWith("Basic ")
        ? Buffer.from(authorization.slice(6), "base64")
            .toString()
            .split(":")
            .slice(1)
            .join(":")
        : "";
    return timingSafeEqual(
      secret,
      createHash("sha256").update(provided).digest(),
    );
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("Cache-Control", "no-store, no-transform");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(data));
    };
    // Volatile abuse controls only; no access logs, identifiers or payload diagnostics.
    const now = Date.now();
    for (const [key, value] of rate) if (value.until < now) rate.delete(key);
    const forwarded = request.headers["x-forwarded-for"];
    const peer = request.socket.remoteAddress;
    const address =
      config.reverseProxy &&
      ["127.0.0.1", "::ffff:127.0.0.1"].includes(peer ?? "") &&
      typeof forwarded === "string" &&
      isIP(forwarded)
        ? forwarded
        : (peer ?? "unknown");
    const entry = rate.get(address) ?? { until: now + 60000, requests: 0 };
    entry.requests++;
    if (rate.size < 1000 || rate.has(address)) rate.set(address, entry);
    else {
      send(503, { error: "busy" });
      return;
    }
    if (entry.requests > 120 || active >= 16) {
      send(429, { error: "busy" });
      return;
    }
    active++;
    const deadline = setTimeout(() => request.destroy(), 10000);
    try {
      const url = new URL(request.url ?? "/", "https://service.invalid");
      if (url.pathname === "/health" && request.method === "GET") {
        send(audit.retentionHealthy ? 200 : 503, {
          status: audit.retentionHealthy ? "ok" : "maintenance",
        });
        return;
      }
      if (
        [
          "/",
          "/assets/operator.js",
          "/v1/telemetry/status",
          "/v1/telemetry/metrics",
        ].includes(url.pathname)
      ) {
        if (!authenticated(request)) {
          audit.authorizationDenied = Math.min(
            1e9,
            audit.authorizationDenied + 1,
          );
          response.setHeader(
            "WWW-Authenticate",
            'Basic realm="Private telemetry", charset="UTF-8"',
          );
          send(401, { error: "unauthorized" });
          return;
        }
        if (request.method !== "GET") {
          send(405, { error: "method" });
          return;
        }
        audit.operatorReads = Math.min(1e9, audit.operatorReads + 1);
        if (url.pathname === "/v1/telemetry/status") {
          send(200, audit);
          return;
        }
        if (url.pathname === "/") {
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(operatorPage);
          return;
        }
        if (url.pathname === "/assets/operator.js") {
          response.writeHead(200, { "content-type": "application/javascript" });
          response.end(operatorScript);
          return;
        }
        if (url.pathname === "/v1/telemetry/metrics") {
          const params = Object.fromEntries(url.searchParams);
          if (
            url.searchParams.size > 5 ||
            Object.keys(params).some(
              (k) => !["from", "to", "dimension", "value", "environment"].includes(k),
            ) ||
            !operatorDimensions.includes(
              params.dimension as (typeof operatorDimensions)[number],
            )
          ) {
            send(400, { error: "query" });
            return;
          }
          try {
            send(200, store.query(params as OperatorQuery));
          } catch {
            send(400, { error: "query" });
          }
          return;
        }
      }
      if (
        url.pathname !== "/v1/telemetry/reports" ||
        request.method !== "POST" ||
        url.search
      ) {
        send(404, { error: "route" });
        return;
      }
      if (
        request.headers["content-type"] !== "application/json" ||
        Number(request.headers["content-length"] ?? 0) > telemetryLimits.bytes
      ) {
        send(413, { error: "body" });
        request.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > telemetryLimits.bytes) {
          send(413, { error: "body" });
          request.destroy();
          return;
        }
        chunks.push(bytes);
      }
      let report: unknown;
      try {
        report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        send(400, { error: "schema" });
        return;
      }
      if (!isTelemetryReport(report)) {
        audit.rejectedReports = Math.min(1e9, audit.rejectedReports + 1);
        send(422, { error: "schema" });
        return;
      }
      try {
        const status = store.ingest(report);
        const key =
          status === "accepted" ? "acceptedReports" : "duplicateReports";
        audit[key] = Math.min(1e9, audit[key] + 1);
        send(200, { status });
      } catch {
        send(422, { error: "report" });
      }
    } catch {
      if (!response.headersSent) send(400, { error: "request" });
    } finally {
      clearTimeout(deadline);
      active--;
    }
  };
  const server = config.tls
    ? httpsServer(config.tls, (req, res) => void handle(req, res))
    : httpServer((req, res) => void handle(req, res));
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 20;
  server.maxConnections = 100;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const cleanup = setInterval(() => {
    try {
      store.cleanup();
      audit.retentionHealthy = true;
      audit.lastRetentionAt = new Date().toISOString();
    } catch {
      audit.retentionHealthy = false;
    }
  }, 3600000);
  cleanup.unref();
  return {
    url: `${config.tls ? "https" : "http"}://${config.host}:${(server.address() as { port: number }).port}`,
    close: async () => {
      clearInterval(cleanup);
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      });
      store.close();
      rate.clear();
    },
  };
}
