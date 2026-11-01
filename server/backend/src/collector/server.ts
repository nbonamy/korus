import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  serializeDailyTelemetry,
  type DailyTelemetryPayload,
} from "@workspace/core/telemetry";
import { CollectorAdmission, normalizedAddress } from "./admission";
import type { TelemetryStore } from "./store";

const DAY = 86_400_000;
const MAX_BODY = 65536;
type Options = {
  store: TelemetryStore;
  trustedProxies?: readonly string[];
  now?: () => number;
};
class Rejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retry?: number,
  ) {
    super(code);
  }
}

export function createCollectorServer(options: Options) {
  const proxies = new Set(
    (options.trustedProxies ?? []).map((value) => {
      const address = normalizedAddress(value);
      if (!address) throw new Error("Invalid trusted proxy configuration.");
      return address;
    }),
  );
  const now = options.now ?? Date.now;
  const admission = new CollectorAdmission();
  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 5000,
      requestTimeout: 10_000,
      connectionsCheckingInterval: 1000,
      keepAliveTimeout: 1000,
    },
    (request, response) => {
      void handle(request, response).catch(() =>
        reply(response, 503, "unavailable", 1),
      );
    },
  );
  server.maxHeadersCount = 32;
  server.maxConnections = 128;
  server.on("clientError", (_error, socket) => {
    // Parser errors include rawPacket; never send that error to a logger.
    socket.end(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    let entered = false;
    try {
      if (request.method !== "POST" || request.url !== "/v1/telemetry/daily")
        throw new Rejection(404, "not_found");
      const peer = normalizedAddress(request.socket.remoteAddress ?? "");
      if (!peer) throw new Rejection(400, "invalid");
      const forwarded = request.headers["x-real-ip"];
      const source = proxies.has(peer)
        ? typeof forwarded === "string"
          ? normalizedAddress(forwarded)
          : null
        : peer;
      if (!source) throw new Rejection(400, "invalid");
      const sourceRetry = admission.source(source, now());
      if (sourceRetry) throw new Rejection(429, "limited", sourceRetry);
      if (!admission.enter()) throw new Rejection(429, "limited", 1);
      entered = true;
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers["content-type"] ?? "",
        ) ||
        (request.headers["content-encoding"] !== undefined &&
          request.headers["content-encoding"] !== "identity")
      )
        throw new Rejection(415, "unsupported");
      const declared = request.headers["content-length"];
      if (declared !== undefined && Number(declared) > MAX_BODY)
        throw new Rejection(413, "too_large");
      const bytes = await readBody(request);
      let payload: DailyTelemetryPayload;
      try {
        const input: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        // Use the shared closed validator, including the canonical model catalog.
        // Only its explicitly constructed fields can reach parameterized SQL.
        payload = JSON.parse(
          serializeDailyTelemetry(input as DailyTelemetryPayload).body,
        ) as DailyTelemetryPayload;
      } catch {
        throw new Rejection(400, "invalid");
      }
      const day = Date.parse(payload.day + "T00:00:00Z");
      const today = Math.floor(now() / DAY) * DAY;
      if (day < today - 7 * DAY || (payload.hour === undefined ? day >= today : day + payload.hour * 3600000 > now()))
        throw new Rejection(400, "invalid");
      const installRetry = admission.install(payload.installId, now());
      if (installRetry) throw new Rejection(429, "limited", installRetry);
      await options.store.replace(payload);
      reply(response, 204);
    } catch (error) {
      if (error instanceof Rejection)
        reply(response, error.status, error.code, error.retry);
      else reply(response, 503, "unavailable", 1);
    } finally {
      if (entered) admission.leave();
      request.resume();
    }
  }
  return server;
}

function reply(
  response: ServerResponse,
  status: number,
  error?: string,
  retry?: number,
) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    Connection: "close",
    ...(error ? { "Content-Type": "application/json" } : {}),
    ...(retry ? { "Retry-After": String(retry) } : {}),
  });
  response.end(error ? JSON.stringify({ error }) : undefined);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timeout = setTimeout(
      () => finish(new Rejection(408, "timeout")),
      10_000,
    );
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      request.off("data", data);
      request.off("end", end);
      request.off("error", fail);
      request.off("aborted", aborted);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, size));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) finish(new Rejection(413, "too_large"));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(new Rejection(400, "invalid"));
    const aborted = () => finish(new Rejection(400, "invalid"));
    request.on("data", data);
    request.once("end", end);
    request.once("error", fail);
    request.once("aborted", aborted);
  });
}
