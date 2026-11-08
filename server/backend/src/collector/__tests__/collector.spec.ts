import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, request, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import {
  connect,
  createServer as createTcpServer,
  type AddressInfo,
  type Socket,
} from "node:net";
import pg from "pg";
import type { DailyTelemetryPayload } from "@workspace/core/telemetry";
import { metricsSql } from "../metrics";
import { createCollectorServer } from "../server";
import { createDiagnostics } from "../diagnostics";
import { createTelemetryPool, TelemetryStore } from "../store";
import { disposablePostgres } from "./postgres";

// Public HTTP + real PostgreSQL own this workflow. Failure modes: parser bypass,
// oversized/chunked bodies, forged proxy identity, unbounded limit state/work,
// duplicate/mixed child sets, premature ACK, rollback/connection failure, logging
// sensitive input, stale/future dates and confusing lateness with retention.
const DAY = 86_400_000;
const epoch = Date.parse("2026-10-25T12:00:00Z");
const installId = "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f";
const row = {
  provider: "codex",
  model: "unknown",
  turns: 3,
  inputTokens: 10000,
  cachedInputTokens: 8000,
  outputTokens: 1200,
  estimatedCostUsd: null,
} as const;
function payload(
  overrides: Partial<DailyTelemetryPayload> = {},
): DailyTelemetryPayload {
  return {
    installId,
    day: "2026-10-24",
    appVersion: "1.2.3",
    os: "macos",
    usage: [{ ...row }],
    ...overrides,
  };
}
let database: Awaited<ReturnType<typeof disposablePostgres>>;
let pool: ReturnType<typeof createTelemetryPool>;
let server: Server;
let admin: pg.Client;
let clock: number;
let source = 0;
const diagnostics: string[] = [];
const consoles = [
  vi.spyOn(console, "error"),
  vi.spyOn(console, "warn"),
  vi.spyOn(console, "log"),
];

async function listen(trustedProxies: string[] = ["127.0.0.1"]) {
  server = createCollectorServer({
    store: new TelemetryStore(pool),
    diagnostics: createDiagnostics("collector", (line) => {
      diagnostics.push(line);
    }),
    now: () => clock,
    trustedProxies,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}
type Reply = { status: number; body: string; retry: string | undefined };
async function send(
  body: unknown = payload(),
  options: {
    headers?: Record<string, string>;
    method?: string;
    path?: string;
    chunks?: boolean;
    freshSource?: boolean;
  } = {},
): Promise<Reply> {
  const bytes = Buffer.isBuffer(body)
    ? body
    : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const index = options.freshSource === false ? source : ++source;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        method: options.method ?? "POST",
        path: options.path ?? "/v1/telemetry/daily",
        headers: {
          ...(!options.chunks
            ? { "Content-Length": String(bytes.length) }
            : {}),
          "Content-Type": "application/json",
          "X-Real-IP": `192.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
          ...options.headers,
        },
      },
      (res) => {
        let result = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          result += chunk;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: result,
            retry: res.headers["retry-after"],
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.chunks) {
      req.write(bytes.subarray(0, 100));
      req.end(bytes.subarray(100));
    } else req.end(bytes);
  });
}
async function snapshot() {
  return {
    installs: (
      await pool.query(
        "SELECT install_id::text, first_reported_day::text FROM installs ORDER BY install_id",
      )
    ).rows,
    days: (
      await pool.query(
        "SELECT install_id::text, day::text, app_version, os FROM install_days ORDER BY install_id, day",
      )
    ).rows,
    usage: (
      await pool.query(
        "SELECT install_id::text, day::text, provider, model, turns::text, input_tokens::text, cached_input_tokens::text, output_tokens::text, estimated_cost_usd::text FROM usage_daily ORDER BY install_id, day, provider, model",
      )
    ).rows,
  };
}
async function waitFor(check: () => Promise<boolean>) {
  for (let n = 0; n < 200; n++) {
    if (await check()) return;
    await pause(5);
  }
  throw new Error("Observable database state did not settle.");
}
beforeAll(async () => {
  database = await disposablePostgres();
}, 120_000);
beforeEach(async () => {
  diagnostics.length = 0;
  clock = epoch;
  source = 0;
  pool = createTelemetryPool(database.url);
  admin = new pg.Client({ connectionString: database.url });
  await admin.connect();
  const store = new TelemetryStore(pool);
  await store.migrate();
  await store.migrate(); // safe deployment replay
  await pool.query("TRUNCATE installs, install_days CASCADE");
  await listen();
  consoles.forEach((spy) => spy.mockClear());
});
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool?.end();
  await admin?.end();
  expect(consoles.flatMap((spy) => spy.mock.calls)).toStrictEqual([]);
});
afterAll(async () => {
  consoles.forEach((spy) => spy.mockRestore());
  await database?.stop();
});

describe("daily ingestion into disposable Postgres", () => {
  it("replays and replaces one full day, removes children and keeps the first reported day once", async () => {
    expect((await send()).status).toBe(204);
    const first = await snapshot();
    expect(
      (await pool.query("SELECT install_id, first_reported_day FROM installs"))
        .rows,
    ).toStrictEqual([
      { install_id: installId, first_reported_day: "2026-10-24" },
    ]);
    expect(first).toStrictEqual({
      installs: [{ install_id: installId, first_reported_day: "2026-10-24" }],
      days: [
        {
          install_id: installId,
          day: "2026-10-24",
          app_version: "1.2.3",
          os: "macos",
        },
      ],
      usage: [
        {
          install_id: installId,
          day: "2026-10-24",
          provider: "codex",
          model: "unknown",
          turns: "3",
          input_tokens: "10000",
          cached_input_tokens: "8000",
          output_tokens: "1200",
          estimated_cost_usd: null,
        },
      ],
    });
    expect((await send()).status).toBe(204);
    expect(await snapshot()).toStrictEqual(first);
    expect(
      (
        await send(
          payload({
            appVersion: "2.0.0",
            os: "linux",
            usage: [
              {
                ...row,
                provider: "claude",
                model: "custom/モデル 'quoted' @v1",
                inputTokens: null,
                cachedInputTokens: null,
                outputTokens: 0,
                estimatedCostUsd: 0,
              },
            ],
          }),
        )
      ).status,
    ).toBe(204);
    expect((await snapshot()).usage).toStrictEqual([
      {
        install_id: installId,
        day: "2026-10-24",
        provider: "claude",
        model: "custom/モデル 'quoted' @v1",
        turns: "3",
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: "0",
        estimated_cost_usd: "0",
      },
    ]);
    expect((await send(payload({ day: "2026-10-23", usage: [] }))).status).toBe(
      204,
    );
    expect((await snapshot()).installs).toStrictEqual(first.installs);
    expect((await send(payload({ usage: [] }))).status).toBe(204);
    expect((await snapshot()).usage).toStrictEqual([]);
    expect((await snapshot()).days).toHaveLength(2);
  });

  it('replaces hourly buckets idempotently while preserving daily dashboard totals and legacy ingestion', async () => {
    expect((await send()).status).toBe(204); // Older daily payload.
    const hourly = (hour:number,input:number) => payload({hour,usage:[{...row,inputTokens:input,cachedInputTokens:0}]});
    expect((await send(hourly(10,20))).status).toBe(204);
    expect((await send(hourly(11,30))).status).toBe(204);
    expect((await send(hourly(10,25))).status).toBe(204);
    expect((await send(hourly(10,25))).status).toBe(204); // Lost acknowledgment.
    expect((await send()).status).toBe(204); // Downgraded client cannot duplicate hourly usage.
    const totals = (await pool.query(metricsSql,['2026-10-24','2026-10-24',null,null,false,'UTC'])).rows[0].metrics;
    expect(totals.totals).toMatchObject({turns:'6',inputTokens:'55',groups:'1'});
    expect(totals.activity).toStrictEqual([{day:'2026-10-24',activeInstalls:'1',firstReportedInstalls:'1'}]);
    expect((await pool.query('SELECT report_hour FROM usage_daily ORDER BY report_hour')).rows).toStrictEqual([{report_hour:10},{report_hour:11}]);
    expect((await send(payload({hour:10,usage:[]}))).status).toBe(204);
    expect((await pool.query('SELECT sum(input_tokens) AS tokens FROM usage_daily')).rows[0].tokens).toBe('30');
    expect((await send(payload({day:'2026-10-25',hour:12}))).status).toBe(204);
    expect((await send(payload({day:'2026-10-25',hour:13}))).status).toBe(400);
  });

  it("serializes concurrent replacements across server instances without mixed child sets or inflated counts", async () => {
    await pool.query(
      "CREATE FUNCTION pause_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.01); RETURN NULL; END $$",
    );
    await pool.query(
      "CREATE TRIGGER pause_fixture AFTER DELETE ON usage_daily FOR EACH STATEMENT EXECUTE FUNCTION pause_fixture()",
    );
    const other = createCollectorServer({
      store: new TelemetryStore(pool),
      now: () => clock,
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const bodies = [
      payload({ usage: [{ ...row, provider: "claude", turns: 1 }] }),
      payload({
        usage: [
          { ...row, turns: 9 },
          { ...row, provider: "antigravity", turns: 9 },
        ],
      }),
    ];
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, async (_, i) => {
          if (i % 2)
            return (
              await fetch(
                `http://127.0.0.1:${(other.address() as AddressInfo).port}/v1/telemetry/daily`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(bodies[i % 2]),
                },
              )
            ).status;
          return (await send(bodies[i % 2])).status;
        }),
      );
      expect(results).toStrictEqual(Array(8).fill(204));
      const saved = await snapshot();
      expect(saved.days).toHaveLength(1);
      expect(saved.installs).toHaveLength(1);
      expect([
        [["claude", "1"]],
        [
          ["antigravity", "9"],
          ["codex", "9"],
        ],
      ]).toContainEqual(saved.usage.map((r) => [r.provider, r.turns]));
    } finally {
      other.closeAllConnections();
      await new Promise<void>((resolve) => other.close(() => resolve()));
      await pool.query("DROP FUNCTION pause_fixture() CASCADE");
    }
  });

  it("does not acknowledge before commit, rolls back a failed replacement and recovers after lock timeout", async () => {
    expect((await send()).status).toBe(204);
    const prior = await snapshot();
    await pool.query(
      "CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.turns = 99 THEN RAISE EXCEPTION 'private-canary'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      "CREATE TRIGGER reject_fixture BEFORE INSERT ON usage_daily FOR EACH ROW EXECUTE FUNCTION reject_fixture()",
    );
    try {
      expect(
        await send(
          payload({ appVersion: "9.0.0", usage: [{ ...row, turns: 99 }] }),
        ),
      ).toStrictEqual({
        status: 503,
        body: '{"error":"unavailable"}',
        retry: "1",
      });
      expect(await snapshot()).toStrictEqual(prior);
    } finally {
      await pool.query("DROP FUNCTION reject_fixture() CASCADE");
    }
    const lock = admin;
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE install_days IN ACCESS EXCLUSIVE MODE");
    let replied = false;
    const pending = send(payload({ usage: [] })).then((value) => {
      replied = true;
      return value;
    });
    try {
      await waitFor(async () => {
        await admin.query("SELECT pg_stat_clear_snapshot()");
        return (
          Number(
            (
              await admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
              )
            ).rows[0].count,
          ) > 0
        );
      });
      expect(replied).toBe(false);
      expect((await pending).status).toBe(503);
    } finally {
      await lock.query("ROLLBACK");
    }
    expect(await snapshot()).toStrictEqual(prior);
    expect((await send()).status).toBe(204);
    expect(diagnostics.map((line) => JSON.parse(line))).toStrictEqual([
      {
        timestamp: expect.any(String),
        level: "error",
        service: "collector",
        event: "operation_failed",
        operation: "telemetry_write",
        reason: "database_exception",
        code: "P0001",
        message: expect.any(String),
      },
      {
        timestamp: expect.any(String),
        level: "error",
        service: "collector",
        event: "operation_failed",
        operation: "telemetry_write",
        reason: "database_lock_timeout",
        code: "55P03",
        message: expect.any(String),
      },
    ]);
    expect(diagnostics.join("")).not.toMatch(
      /private-canary|d8b65ff5|192\.0|INSERT|usage_daily/,
    );
  }, 10_000);

  it("does not create a second logical day when a client loses its acknowledgement", async () => {
    // A real intermediary forwards the committed request, then drops the ACK.
    const proxy = createServer((incoming, outgoing) => {
      const forwarded = request(
        {
          host: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          method: "POST",
          path: "/v1/telemetry/daily",
          headers: {
            "Content-Type": "application/json",
            "X-Real-IP": "192.0.2.99",
          },
        },
        (response) => {
          response.resume();
          response.once("end", () => outgoing.destroy());
        },
      );
      forwarded.on("error", () => outgoing.destroy());
      incoming.pipe(forwarded);
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request({
          host: "127.0.0.1",
          port: (proxy.address() as AddressInfo).port,
          method: "POST",
          path: "/v1/telemetry/daily",
          headers: { "Content-Type": "application/json" },
        });
        req.on("error", (error) =>
          (error as NodeJS.ErrnoException).code === "ECONNRESET"
            ? resolve()
            : reject(error),
        );
        req.on("response", () =>
          reject(new Error("The acknowledgement was supposed to be lost.")),
        );
        req.end(JSON.stringify(payload()));
      });
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
    expect((await snapshot()).days).toHaveLength(1);
    expect((await send()).status).toBe(204);
    expect((await snapshot()).days).toHaveLength(1);
    expect((await snapshot()).usage[0].turns).toBe("3");
  });

  it("rejects invalid closed contracts without changing any persisted row or echoing canaries", async () => {
    expect((await send()).status).toBe(204);
    const prior = await snapshot();
    const bad: unknown[] = [
      null,
      [],
      {},
      { ...payload(), prompt: "private-canary" },
      { ...payload(), installId: "private-canary" },
      payload({ day: "2026-02-30" }),
      payload({ appVersion: "1.2.3-private-canary" }),
      payload({ os: "private-canary" as never }),
      payload({ usage: [{ ...row, provider: "" }] }),
      payload({ usage: [{ ...row, model: "" }] }),
      payload({ usage: [{ ...row, turns: -1 }] }),
      payload({ usage: [{ ...row, inputTokens: 0.5 }] }),
      payload({
        usage: [{ ...row, outputTokens: Number.MAX_SAFE_INTEGER + 1 }],
      }),
      payload({ usage: [{ ...row, cachedInputTokens: 10001 }] }),
      payload({ usage: [{ ...row, estimatedCostUsd: -1 }] }),
      payload({ usage: [{ ...row, estimatedCostUsd: 1e9 + 1 }] }),
      payload({ usage: [{ ...row, turns: "3" as never }] }),
      payload({ usage: [{ ...row, prompt: "private-canary" } as never] }),
      payload({ usage: [{ ...row }, { ...row }] }),
      payload({ usage: Array.from({ length: 257 }, () => ({ ...row })) }),
      '{"installId":',
      JSON.stringify(payload()).replace("10000", "1e999"),
      Buffer.concat([
        Buffer.from(JSON.stringify(payload()).replace("1.2.3", "")),
        Buffer.from([0xff]),
      ]),
    ];
    for (const value of bad) {
      const result = await send(value);
      expect(result).toStrictEqual({
        status: 400,
        body: '{"error":"invalid"}',
        retry: undefined,
      });
      expect(await snapshot()).toStrictEqual(prior);
    }
  });

  it("accepts measured zero, null, safe maxima, all OS enums, arbitrary providers and 256 distinct full model names", async () => {
    for (const os of ["macos", "windows", "linux", "unknown"] as const)
      expect(
        (
          await send(
            payload({
              os,
              usage: [
                {
                  ...row,
                  inputTokens: Number.MAX_SAFE_INTEGER,
                  cachedInputTokens: 0,
                  outputTokens: null,
                  estimatedCostUsd: 1e9,
                },
              ],
            }),
          )
        ).status,
      ).toBe(204);
    const groups = Array.from({length:256}, (_, index) => ({
      ...row,
      provider: ["antigravity", "claude", "codex", "cursor", "custom/é-harness 'quoted'"][index % 5],
      model: `custom/model-${index}`,
    })) as DailyTelemetryPayload["usage"];
    expect(groups).toHaveLength(256);
    expect((await send(payload({ usage: groups }))).status).toBe(204);
    expect((await snapshot()).usage).toHaveLength(256);
  });

  it("enforces 64 KiB on declared and streamed bytes before parsing and rejects non-JSON transports", async () => {
    const body = JSON.stringify(payload({ usage: [] }));
    expect(
      (await send(body + " ".repeat(65536 - Buffer.byteLength(body)))).status,
    ).toBe(204);
    for (const chunks of [false, true])
      expect(
        await send(body + " ".repeat(65537 - Buffer.byteLength(body)), {
          chunks,
        }),
      ).toStrictEqual({
        status: 413,
        body: '{"error":"too_large"}',
        retry: undefined,
      });
    for (const headers of [
      { "Content-Type": "text/plain" },
      { "Content-Encoding": "gzip" },
    ] as Record<string, string>[])
      expect((await send(payload(), { headers })).status).toBe(415);
    expect((await send(payload(), { method: "GET" })).status).toBe(404);
    expect(
      (await send(payload(), { path: "/v1/telemetry/daily?private-canary" }))
        .status,
    ).toBe(404);
    expect(
      (
        await send(payload(), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        })
      ).status,
    ).toBe(204);
  });

  it("accepts historical reporting dates without an age cutoff and rejects future or unfinished daily reports", async () => {
    expect((await send(payload({ day: "2026-10-18" }))).status).toBe(204);
    expect((await send(payload({ day: "2020-01-01", hour: 4 }))).status).toBe(204);
    expect((await send(payload({ day: "2026-10-17" }))).status).toBe(204);
    for (const day of ["2026-10-25", "2026-10-26"])
      expect((await send(payload({ day }))).status).toBe(400);
    clock += 800 * DAY;
    expect(
      (
        await send(
          payload({ day: new Date(clock - DAY).toISOString().slice(0, 10) }),
        )
      ).status,
    ).toBe(204);
    expect((await snapshot()).days.map((r) => r.day)).toContain("2026-10-18");
  });
});

describe("bounded anonymous admission", () => {
  it("bounds a connected database transport that stops returning replies", async () => {
    // A TCP intermediary forwards to the real database, then loses replies after
    // authentication. Server-side SQL deadlines alone cannot bound this failure.
    let loseReplies = false;
    const sockets = new Set<Socket>();
    const databaseUrl = new URL(database.url);
    const realPort = Number(databaseUrl.port);
    const proxy = createTcpServer((client) => {
      const upstream = connect(realPort, databaseUrl.hostname);
      sockets.add(client);
      sockets.add(upstream);
      client.on("data", (bytes) => upstream.write(bytes));
      upstream.on("data", (bytes) => {
        if (!loseReplies) client.write(bytes);
      });
      client.on("error", () => {});
      upstream.on("error", () => client.destroy());
      client.on("close", () => {
        upstream.destroy();
        sockets.delete(client);
      });
      upstream.on("close", () => {
        if (!loseReplies) client.destroy();
        sockets.delete(upstream);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    databaseUrl.port = String((proxy.address() as AddressInfo).port);
    const delayedPool = createTelemetryPool(databaseUrl.toString());
    try {
      await delayedPool.query("SELECT 1");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server = createCollectorServer({
        store: new TelemetryStore(delayedPool),
        now: () => clock,
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      loseReplies = true;
      expect(
        await Promise.race([
          send(),
          pause(9000).then(() => {
            throw new Error("Database response deadline was not enforced.");
          }),
        ]),
      ).toStrictEqual({
        status: 503,
        body: '{"error":"unavailable"}',
        retry: "1",
      });
      expect((await snapshot()).days).toStrictEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await delayedPool.end();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 12_000);

  it("bounds unfinished bodies and handles malformed HTTP without logging or echoing input", async () => {
    const aborted = request({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      method: "POST",
      path: "/v1/telemetry/daily",
      headers: {
        "Content-Type": "application/json",
        "X-Real-IP": "192.0.2.91",
      },
    });
    aborted.on("error", () => {});
    aborted.write("{");
    await pause(10);
    aborted.destroy();
    await pause(10);
    expect((await send()).status).toBe(204);
    const raw = async (text: string, timeout = false) => {
      const socket = connect(
        (server.address() as AddressInfo).port,
        "127.0.0.1",
      );
      let body = "";
      const ended = new Promise<string>((resolve, reject) => {
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          body += chunk;
        });
        socket.on("end", () => resolve(body));
        socket.on("error", reject);
      });
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      try {
        if (timeout)
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        socket.write(text);
        if (timeout) {
          await pause(10);
          await vi.advanceTimersByTimeAsync(10_000);
        }
        return await ended;
      } finally {
        socket.destroy();
        vi.useRealTimers();
      }
    };
    const malformed = await raw(
      "POST /v1/telemetry/daily HTTP/1.1\r\nHost: localhost\r\nprivate-canary\r\n\r\n",
    );
    expect(malformed).toBe(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    const timed = await raw(
      "POST /v1/telemetry/daily HTTP/1.1\r\nHost: localhost\r\nX-Real-IP: 192.0.2.90\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{",
      true,
    );
    expect(timed).toContain("HTTP/1.1 408");
    expect(timed).toContain('{"error":"timeout"}');
    expect((await send()).status).toBe(204);
  });

  it("bounds transient source/identity state without evicting live quotas and reclaims expired state", async () => {
    // Fill both 4096-key budgets through actual HTTP, with no unbounded fixture
    // injection into the limiter. Empty reports still exercise real transactions.
    for (let i = 0; i < 4096; i++)
      expect(
        (await send(payload({ installId: randomUUID(), usage: [] }))).status,
      ).toBe(204);
    // A new source is denied; an existing source cannot reset the full ID map.
    expect(
      (await send(payload({ installId: randomUUID(), usage: [] }))).status,
    ).toBe(429);
    expect(
      (
        await send(payload({ installId: randomUUID(), usage: [] }), {
          headers: { "X-Real-IP": "192.0.0.2" },
        })
      ).status,
    ).toBe(429);
    clock += 3_600_000;
    expect(
      (await send(payload({ installId: randomUUID(), usage: [] }))).status,
    ).toBe(204);
    expect((await snapshot()).installs).toHaveLength(4097);
  }, 60_000);

  it("normalizes equivalent IPv6 spellings and refuses forged proxy address lists", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (await send({}, { headers: { "X-Real-IP": "::ffff:192.0.2.40" } }))
          .status,
      ).toBe(400);
    expect(
      (await send({}, { headers: { "X-Real-IP": "::ffff:c000:228" } })).status,
    ).toBe(429);
    for (let i = 0; i < 10; i++)
      expect(
        (await send({}, { headers: { "X-Real-IP": "2001:db8::1" } })).status,
      ).toBe(400);
    expect(
      (await send({}, { headers: { "X-Real-IP": "2001:0db8:0:0:0:0:0:1" } }))
        .status,
    ).toBe(429);
    expect(
      (await send({}, { headers: { "X-Real-IP": "2001:db8::2" } })).status,
    ).toBe(400);
  });

  it("maps a lost database connection to a generic retryable error and recovers without partial rows", async () => {
    expect((await send()).status).toBe(204);
    const prior = await snapshot();
    await admin.query("BEGIN");
    await admin.query("LOCK TABLE install_days IN ACCESS EXCLUSIVE MODE");
    const pending = send(payload({ appVersion: "9.0.0", usage: [] }));
    try {
      await waitFor(async () => {
        await admin.query("SELECT pg_stat_clear_snapshot()");
        return (
          Number(
            (
              await admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='telemetry-collector' AND wait_event_type='Lock'",
              )
            ).rows[0].count,
          ) === 1
        );
      });
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='telemetry-collector'",
      );
      expect(await pending).toStrictEqual({
        status: 503,
        body: '{"error":"unavailable"}',
        retry: "1",
      });
    } finally {
      await admin.query("ROLLBACK");
    }
    expect(await snapshot()).toStrictEqual(prior);
    expect((await send()).status).toBe(204);
  });

  it("limits bursts and a rolling source minute, ignores forged forwarding from untrusted peers and expires limits", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await listen([]);
    for (let i = 0; i < 10; i++)
      expect((await send(payload({ installId: randomUUID() }))).status).toBe(
        204,
      );
    expect((await send(payload({ installId: randomUUID() }))).status).toBe(429);
    for (let i = 0; i < 50; i++) {
      clock += 1000;
      expect((await send(payload({ installId: randomUUID() }))).status).toBe(
        204,
      );
    }
    clock += 1000;
    const limited = await send(payload({ installId: randomUUID() }));
    expect(limited.status).toBe(429);
    expect(Number(limited.retry)).toBeGreaterThan(0);
    expect(Number(limited.retry)).toBeLessThanOrEqual(60);
    clock += 10_000;
    expect((await send(payload({ installId: randomUUID() }))).status).toBe(204);
  });

  it("separates trusted proxy sources and permits paced backlog delivery with an independent install-minute limit", async () => {
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(204);
    expect(await send()).toStrictEqual({
      status: 429,
      body: '{"error":"limited"}',
      retry: "60",
    });
    expect((await send(payload({ installId: randomUUID() }))).status).toBe(204);
    clock += 60_000;
    expect((await send()).status).toBe(204);
    for (let i = 0; i < 35; i++) {
      clock += 2100;
      expect((await send()).status).toBe(204);
    }
    for (const address of ["", "192.0.2.1, 192.0.2.2", "private-canary"])
      expect(
        (await send(payload(), { headers: { "X-Real-IP": address } })).status,
      ).toBe(400);
  });

  it("caps in-flight database work at 20 and releases permits after completion", async () => {
    const lock = admin;
    await lock.query("BEGIN");
    await lock.query("LOCK TABLE install_days IN ACCESS EXCLUSIVE MODE");
    const requests = Array.from({ length: 20 }, () =>
      send(payload({ installId: randomUUID() })),
    );
    try {
      await waitFor(async () => {
        await admin.query("SELECT pg_stat_clear_snapshot()");
        return (
          Number(
            (
              await admin.query(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
              )
            ).rows[0].count,
          ) === 20
        );
      });
      expect(await send(payload({ installId: randomUUID() }))).toStrictEqual({
        status: 429,
        body: '{"error":"limited"}',
        retry: "1",
      });
    } finally {
      await lock.query("ROLLBACK");
    }
    expect((await Promise.all(requests)).map((r) => r.status)).toStrictEqual(
      Array(20).fill(204),
    );
    expect((await send()).status).toBe(204);
  }, 10_000);

  it("produces repeatable sanitized HTTP/database evidence", async () => {
    const statuses = [
      (await send()).status,
      (await send()).status,
      (await send(payload({ usage: [] }))).status,
      (
        await send({
          ...payload(),
          prompt: "private-canary",
          path: "/private-canary",
          agent: "private-canary",
        })
      ).status,
    ];
    const saved = await snapshot();
    const evidence = {
      postgres: (await pool.query("SHOW server_version")).rows[0]
        .server_version,
      statuses,
      installs: saved.installs.length,
      activeDays: saved.days.length,
      usageGroups: saved.usage.length,
      loggedRequests: consoles.flatMap((s) => s.mock.calls).length,
    };
    expect(evidence).toMatchObject({
      statuses: [204, 204, 204, 400],
      installs: 1,
      activeDays: 1,
      usageGroups: 0,
      loggedRequests: 0,
    });
    if (process.env.TELEMETRY_COLLECTOR_EVIDENCE)
      await writeFile(
        process.env.TELEMETRY_COLLECTOR_EVIDENCE,
        JSON.stringify(evidence, null, 2) + "\n",
      );
  });
});
