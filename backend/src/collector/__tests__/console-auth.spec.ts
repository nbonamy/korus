import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, request as httpRequest } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createConsoleAuthServer } from "../console-auth";
import { runCollector } from "../cli";

// HTTP owner boundary: credential/CSRF bypass, fixation/tampering, expiry/logout,
// unbounded sessions/hash work/bodies, unsafe HTTP and secrets in responses.
const password = "synthetic-operator-password-canary";
const origin = "https://console.invalid";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function fixture(
  options: Partial<Parameters<typeof createConsoleAuthServer>[0]> = {},
) {
  const server = createConsoleAuthServer({
    consoleOrigin: origin,
    password,
    ...options,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/session`;
  const call = (
    method = "GET",
    cookie = "",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(endpoint, {
      method,
      headers: {
        ...(method === "POST" || method === "DELETE" ? { origin } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
  const login = async (cookie = "") => {
    const response = await call("POST", cookie, {
      username: "admin",
      password,
    });
    expect(response.status).toBe(204);
    const header = response.headers.get("set-cookie")!;
    return { cookie: header.split(";")[0]!, header };
  };
  return { call, login, endpoint };
}
it("protects login, session checks, rotation, logout and expiry through HTTP", async () => {
  let now = 1_000_000;
  const f = await fixture({ now: () => now });
  const anonymous = await f.call();
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("www-authenticate")).toBeNull();
  expect(anonymous.headers.get("cache-control")).toBe("no-store");
  for (const supplied of [
    { username: "foreign-user-canary", password },
    { username: "admin", password: "wrong-password-canary" },
  ]) {
    const denied = await f.call("POST", "", supplied);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toStrictEqual({ error: "unauthorized" });
  }
  const first = await f.login();
  expect(first.header).toMatch(/^__Host-console_session=/);
  for (const attribute of [
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=28800",
  ])
    expect(first.header).toContain(attribute);
  expect(first.header).not.toContain("Domain=");
  expect((await f.call("GET", first.cookie)).status).toBe(204);
  expect((await f.call("GET", `${first.cookie}x`)).status).toBe(401);
  expect((await f.call("GET", `${first.cookie}; ${first.cookie}`)).status).toBe(
    401,
  );
  for (const foreign of ["", "null", "https://other.invalid"]) {
    expect(
      (
        await f.call(
          "POST",
          "",
          { username: "admin", password },
          { origin: foreign },
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.call("DELETE", first.cookie, undefined, { origin: foreign }))
        .status,
    ).toBe(403);
  }
  expect((await f.call("GET", first.cookie)).status).toBe(204);
  const rotated = await f.login(first.cookie);
  expect(rotated.cookie).not.toBe(first.cookie);
  expect((await f.call("GET", first.cookie)).status).toBe(401);
  const logout = await f.call("DELETE", rotated.cookie);
  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  expect((await f.call("GET", rotated.cookie)).status).toBe(401);
  expect((await f.call("DELETE")).status).toBe(204);
  const expiring = await f.login();
  now += 8 * 60 * 60 * 1000;
  expect((await f.call("GET", expiring.cookie)).status).toBe(401);
  expect(
    (await fetch(f.endpoint.replace("/auth/session", "/metrics"))).status,
  ).toBe(404);
});
it("bounds input and login work and returns generic rate limits without recording identity", async () => {
  let now = 0;
  const f = await fixture({ now: () => now });
  for (const [body, status, headers] of [
    ["{bad", 400, {}],
    [{ username: "admin", password, extra: true }, 400, {}],
    [{ username: "admin", password }, 415, { "content-type": "text/plain" }],
    ["x".repeat(4097), 413, {}],
    [{ username: "admin", password: "x".repeat(1025) }, 400, {}],
  ] as const) {
    const response = await f.call("POST", "", body, headers);
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).not.toContain(password);
    expect(text).not.toContain("admin");
    now += 60000;
  }
  const chunked = await new Promise<number>((resolve) => {
    const request = httpRequest(
      f.endpoint,
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    request.end("x".repeat(4097));
  });
  expect(chunked).toBe(413);
  now += 60000;
  for (let attempt = 0; attempt < 10; attempt++)
    expect(
      (await f.call("POST", "", { username: "admin", password: "wrong" }))
        .status,
    ).toBe(401);
  const limited = await f.call("POST", "", { username: "admin", password });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  expect(await limited.json()).toStrictEqual({ error: "limited" });
  now += 60000;
  expect((await f.login()).cookie).toBeTruthy();
});
it("caps live sessions, fails closed on restart and only permits explicit loopback HTTP", async () => {
  const f = await fixture({ maxSessions: 2 });
  const one = await f.login();
  const two = await f.login();
  const three = await f.login();
  expect((await f.call("GET", one.cookie)).status).toBe(401);
  expect((await f.call("GET", two.cookie)).status).toBe(204);
  expect((await f.call("GET", three.cookie)).status).toBe(204);
  const restarted = await fixture();
  expect((await restarted.call("GET", three.cookie)).status).toBe(401);
  for (const patch of [
    { consoleOrigin: "http://console.invalid", allowInsecureLoopback: true },
    { consoleOrigin: "http://127.0.0.1:1234" },
    { password: "short" },
    { password: "" },
  ]) {
    expect(() =>
      createConsoleAuthServer({ consoleOrigin: origin, password, ...patch }),
    ).toThrow("Invalid console authentication configuration.");
  }
  const local = await fixture({
    consoleOrigin: "http://127.0.0.1:1234",
    allowInsecureLoopback: true,
  });
  const response = await local.call(
    "POST",
    "",
    { username: "admin", password },
    { origin: "http://127.0.0.1:1234" },
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("set-cookie")).toMatch(/^console_session=/);
  expect(response.headers.get("set-cookie")).not.toContain("Secure");
});
it("starts the standalone auth role from external files without database credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "console-auth-cli-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const config = path.join(directory, "auth.json");
  await writeFile(
    config,
    JSON.stringify({
      listenHost: "127.0.0.1",
      listenPort: port,
      consoleOrigin: origin,
      allowInsecureLoopback: false,
    }),
  );
  await expect(runCollector(["auth", config], {})).rejects.toThrow(
    "Collector startup failed.",
  );
  const runtime = await runCollector(["auth", config], {
    TELEMETRY_CONSOLE_PASSWORD: password,
  });
  cleanup.push(() => runtime!.close());
  expect((await fetch(`http://127.0.0.1:${port}/auth/session`)).status).toBe(
    401,
  );
});
