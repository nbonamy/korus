import { expect, it, vi } from "vitest";
import { startApiServer } from "../server";
const token = "synthetic-private-console-operator-password-only";
it("opens a branded welcome page and uses expiring, revocable, host-only cookies for private console access", async () => {
  const service = await startApiServer({
    database: ":memory:",
    operatorToken: token,
    host: "127.0.0.1",
    port: 0,
    synthetic: true,
  });
  const origin = service.url;
  const session = origin + "/v1/operator/session";
  const metrics = origin + "/v1/telemetry/status";
  const signIn = (password: string, from = origin) =>
    fetch(session, {
      method: "POST",
      headers: { origin: from, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
  try {
    const welcome = await fetch(origin);
    expect(welcome.status).toBe(200);
    expect(welcome.headers.get("www-authenticate")).toBeNull();
    expect(welcome.headers.get("content-security-policy")).toContain(
      "img-src 'self'",
    );
    expect(await welcome.text()).toContain('src="/assets/logo.svg"');
    expect(
      (await fetch(origin + "/assets/logo.svg")).headers.get("content-type"),
    ).toContain("image/svg+xml");
    expect((await fetch(origin + "/assets/sign-in.js")).status).toBe(200);
    expect((await fetch(metrics)).status).toBe(401);
    // Cached browser Basic credentials must not silently sign the operator back in after logout.
    const legacy = {
      authorization:
        "Basic " + Buffer.from("operator:" + token).toString("base64"),
    };
    expect((await fetch(metrics, { headers: legacy })).status).toBe(401);
    const wrong = await signIn("wrong");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect((await signIn(token, "https://other.example")).status).toBe(403);
    const login = await signIn(token);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    for (const attribute of [
      "console_session=",
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=7200",
    ])
      expect(cookie).toContain(attribute);
    expect(cookie).not.toContain(token);
    expect(cookie).not.toContain("Secure;");
    expect(cookie).not.toContain("Domain=");
    const headers = { cookie: cookie.split(";")[0]! };
    expect((await fetch(metrics, { headers })).status).toBe(200);
    const dashboard = await fetch(origin, { headers }).then((response) =>
      response.text(),
    );
    expect(dashboard).toContain('id="sign-out"');
    expect(dashboard).not.toContain(token);
    expect(
      (
        await fetch(metrics, {
          headers: { cookie: headers.cookie + "tampered" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(metrics, {
          headers: { cookie: headers.cookie + "; " + headers.cookie },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(session, {
          method: "DELETE",
          headers: { ...headers, origin: "https://other.example" },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(metrics, { headers })).status).toBe(200);
    const logout = await fetch(session, {
      method: "DELETE",
      headers: { ...headers, origin },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await fetch(metrics, { headers })).status).toBe(401);
    const expiring = (await signIn(token)).headers
      .get("set-cookie")!
      .split(";")[0]!;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 7200001);
    expect(
      (await fetch(metrics, { headers: { cookie: expiring } })).status,
    ).toBe(401);
  } finally {
    vi.restoreAllMocks();
    await service.close();
  }
});

it("rejects cross-origin login and bounded malformed inputs without setting a session cookie", async () => {
  const service = await startApiServer({
    database: ":memory:",
    operatorToken: token,
    host: "127.0.0.1",
    port: 0,
    synthetic: true,
  });
  try {
    for (const [init, status] of [
      [{ method: "GET" }, 405],
      [{ method: "POST", body: JSON.stringify({ password: token }) }, 403],
      [
        {
          method: "POST",
          headers: { origin: service.url, "content-type": "text/plain" },
          body: token,
        },
        413,
      ],
      ...[
        "{",
        JSON.stringify({ password: token, redirect: "https://other.example" }),
        JSON.stringify({ password: "x".repeat(1025) }),
      ].map(
        (body) =>
          [
            {
              method: "POST",
              headers: {
                origin: service.url,
                "content-type": "application/json",
              },
              body,
            },
            400,
          ] as const,
      ),
      [
        {
          method: "POST",
          headers: { origin: service.url, "content-type": "application/json" },
          body: "x".repeat(2049),
        },
        413,
      ],
    ] as const) {
      const response = await fetch(service.url + "/v1/operator/session", init);
      expect(response.status).toBe(status);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).not.toContain(token);
    }
  } finally {
    await service.close();
  }
});
