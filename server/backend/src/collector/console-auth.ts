import { createServer, type IncomingMessage } from "node:http";
import {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { Diagnostics } from "./diagnostics";

const loginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();
const derive = promisify(scrypt);
const digest = (value: string) => createHash("sha256").update(value).digest();
const TTL = 8 * 60 * 60 * 1000;
class Rejection extends Error {
  constructor(readonly status: number) {
    super();
  }
}

/** Private operator sessions only. No database, telemetry identity, IP/session/body
 * logger, shared snapshot or persistent session store belongs to this service. */
export function createConsoleAuthServer(options: {
  consoleOrigin: string;
  password: string;
  allowInsecureLoopback?: boolean;
  now?: () => number;
  maxSessions?: number;
  diagnostics?: Diagnostics;
}) {
  let secure: boolean;
  let expectedPassword: Buffer;
  const salt = randomBytes(16);
  const maxSessions = options.maxSessions ?? 128;
  try {
    const origin = new URL(options.consoleOrigin);
    secure = origin.protocol === "https:";
    if (
      origin.origin !== options.consoleOrigin ||
      (!secure &&
        !(
          origin.protocol === "http:" &&
          options.allowInsecureLoopback === true &&
          ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname)
        )) ||
      typeof options.password !== "string" ||
      options.password.length < 16 ||
      Buffer.byteLength(options.password) > 1024 ||
      !Number.isInteger(maxSessions) ||
      maxSessions < 1 ||
      maxSessions > 128
    )
      throw new Error();
    expectedPassword = scryptSync(options.password, salt, 64);
  } catch {
    throw new Error("Invalid console authentication configuration.");
  }
  const now = options.now ?? Date.now;
  const name = secure ? "__Host-console_session" : "console_session";
  const sessions = new Map<string, number>();
  let windowStart = now(),
    attempts = 0,
    active = 0;
  const session = (request: IncomingMessage): string | null => {
    const values = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const value = values[0]!.slice(name.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    return digest(value).toString("hex");
  };
  const purge = () => {
    for (const [id, expires] of sessions)
      if (expires <= now()) sessions.delete(id);
  };
  const cookie = (value: string, expires: boolean) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : TTL / 1000}${secure ? "; Secure" : ""}`;
  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: 5000,
      requestTimeout: 5000,
      keepAliveTimeout: 1000,
      connectionsCheckingInterval: 1000,
    },
    (request, response) => {
      const reply = (status: number, setCookie?: string, retry?: number) => {
        if (response.writableEnded || response.destroyed) return;
        response.writeHead(status, {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          Connection: "close",
          ...(setCookie ? { "Set-Cookie": setCookie } : {}),
          ...(retry ? { "Retry-After": String(retry) } : {}),
          ...(status !== 204 ? { "Content-Type": "application/json" } : {}),
        });
        const error =
          status === 401
            ? "unauthorized"
            : status === 403
              ? "forbidden"
              : status === 429
                ? "limited"
                : status === 404
                  ? "not_found"
                  : status === 503
                    ? "unavailable"
                    : "invalid";
        response.end(status === 204 ? undefined : JSON.stringify({ error }));
      };
      void (async () => {
        if (
          request.url !== "/auth/session" ||
          !["GET", "POST", "DELETE"].includes(request.method ?? "")
        ) {
          reply(404);
          return;
        }
        if (
          (request.method !== "GET" || request.headers.origin !== undefined) &&
          request.headers.origin !== options.consoleOrigin
        ) {
          reply(403);
          return;
        }
        purge();
        if (request.method === "GET") {
          reply(sessions.has(session(request) ?? "") ? 204 : 401);
          return;
        }
        if (request.method === "DELETE") {
          sessions.delete(session(request) ?? "");
          reply(204, cookie("", true));
          return;
        }
        if (now() - windowStart >= 60000 || now() < windowStart) {
          windowStart = now();
          attempts = 0;
        }
        if (attempts >= 10 || active >= 2) {
          reply(
            429,
            undefined,
            Math.max(
              1,
              Math.min(60, Math.ceil((windowStart + 60000 - now()) / 1000)),
            ),
          );
          return;
        }
        attempts++;
        if (
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            request.headers["content-type"] ?? "",
          ) ||
          (request.headers["content-encoding"] !== undefined &&
            request.headers["content-encoding"] !== "identity")
        )
          throw new Rejection(415);
        const bytes = await body(request);
        let input: z.infer<typeof loginSchema>;
        try {
          input = loginSchema.parse(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
        } catch {
          throw new Rejection(400);
        }
        // Reserve bounded hash capacity immediately before asynchronous scrypt.
        if (active >= 2) {
          reply(429, undefined, 1);
          return;
        }
        active++;
        let passwordHash: Buffer;
        try {
          passwordHash = (await derive(input.password, salt, 64)) as Buffer;
        } finally {
          active--;
        }
        const passwordMatches = timingSafeEqual(passwordHash, expectedPassword);
        const usernameMatches = timingSafeEqual(
          digest(input.username),
          digest("admin"),
        );
        if (!passwordMatches || !usernameMatches) {
          reply(401);
          return;
        }
        sessions.delete(session(request) ?? "");
        purge();
        while (sessions.size >= maxSessions)
          sessions.delete(sessions.keys().next().value!);
        const id = randomBytes(32).toString("base64url");
        sessions.set(digest(id).toString("hex"), now() + TTL);
        reply(204, cookie(id, false));
      })()
        .catch((error) => {
          if (!(error instanceof Rejection))
            options.diagnostics?.failure("auth_session", error);
          reply(error instanceof Rejection ? error.status : 503);
        })
        .finally(() => request.resume());
    },
  );
  server.maxHeadersCount = 32;
  server.maxConnections = 32;
  server.on("clientError", (_error, socket) =>
    socket.end(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    ),
  );
  server.on("close", () => sessions.clear());
  return server;
}
function body(request: IncomingMessage): Promise<Buffer> {
  if (Number(request.headers["content-length"]) > 4096)
    return Promise.reject(new Rejection(413));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", end);
      request.off("error", fail);
      request.off("aborted", fail);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, size));
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) finish(new Rejection(413));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const fail = () => finish(new Rejection(400));
    const timer = setTimeout(() => finish(new Rejection(408)), 2000);
    request.on("data", data);
    request.on("end", end);
    request.on("error", fail);
    request.on("aborted", fail);
  });
}
