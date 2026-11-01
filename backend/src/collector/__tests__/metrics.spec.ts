import type { TelemetryMetrics } from "@workspace/core/telemetry-metrics";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setTimeout as pause } from "node:timers/promises";
import { readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTelemetryPool, TelemetryStore } from "../store";
import { createMetricsServer } from "../metrics-server";
import { metricsSql } from "../metrics";
import { disposablePostgres } from "./postgres";

// Owner HTTP + real Postgres: access/origin bypass, usage filters changing DAU,
// duplicate model inflation, boundary windows, unknown-as-zero, cache double
// count, truncated history/series, SQL injection and identity/error disclosure.
let db: Awaited<ReturnType<typeof disposablePostgres>>;
let pool: ReturnType<typeof createTelemetryPool>;
let server: Server;
let base: string;
let seed: string;
const token = "synthetic-private-access-token-32-bytes";
const origin = "https://console.invalid";
const range = "from=2026-10-18&to=2026-10-24";
async function get(
  query = range,
  headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    origin,
  },
  method = "GET",
) {
  return fetch(`${base}/v1/telemetry/metrics?${query}`, { method, headers });
}
beforeAll(async () => {
  db = await disposablePostgres();
  pool = createTelemetryPool(db.url);
  await new TelemetryStore(pool).migrate();
  seed = await readFile(
    new URL("./fixtures/metrics-seed.sql", import.meta.url),
    "utf8",
  );
  server = createMetricsServer({
    pool,
    accessToken: token,
    consoleOrigin: origin,
    now: () => Date.parse("2026-10-25T12:00Z"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);
beforeEach(async () => {
  await pool.query("TRUNCATE usage_daily,install_days,installs");
  await pool.query(seed);
});
afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await pool?.end();
  await db?.stop();
});
it("requires private access and exact configured origins; rejects invalid and unbounded browser filters", async () => {
  for (const headers of [
    {},
    { authorization: "Basic synthetic" },
    { authorization: "Bearer wrong" },
    { authorization: `Bearer ${token}`, origin: "https://other.invalid" },
    { authorization: `Bearer ${token}`, origin: "null" },
  ] as Record<string, string>[]) {
    const r = await get(range, headers);
    expect([401, 403]).toContain(r.status);
    expect(await r.text()).not.toContain(token);
  }
  for (const query of [
    "",
    "from=2026-02-30&to=2026-10-24",
    "from=2026-10-24&to=2026-10-18",
    range + "&sql=select+*",
    range + "&provider=custom",
    range + "&model=alias",
    range + "&from=2026-10-18",
    "from=2020-01-01&to=2026-10-25",
    "from=2000-01-01&to=2026-10-24",
    range + "&provider=%27%3Bdrop+table+installs",
  ]) {
    const r = await get(query);
    expect(r.status, query).toBe(400);
    expect(await r.json()).toStrictEqual({ error: "invalid" });
  }
  expect((await get(range, undefined, "POST")).status).toBe(404);
  const r = await get();
  expect(r.headers.get("access-control-allow-origin")).toBe(origin);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const foreign = await fetch(base + "/v1/telemetry/daily", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(foreign.status).toBe(404);
});
it("agrees with executable SQL across global activity, complete token pairs, spend gaps and old history", async () => {
  const r = await get();
  expect(r.status).toBe(200);
  const body = (await r.json()) as TelemetryMetrics;
  expect(body.overview).toStrictEqual({
    participatingInstalls: "6",
    dau: "3",
    wau: "4",
    mau: "5",
    calendarMonthActives: "4",
  });
  expect(body.activity).toStrictEqual([
    { day: "2026-10-18", activeInstalls: "2", firstReportedInstalls: "1" },
    { day: "2026-10-19", activeInstalls: "1", firstReportedInstalls: "0" },
    ...["20", "21", "22", "23"].map((d) => ({
      day: `2026-10-${d}`,
      activeInstalls: "0",
      firstReportedInstalls: "0",
    })),
    { day: "2026-10-24", activeInstalls: "3", firstReportedInstalls: "1" },
  ]);
  expect(body.totals).toStrictEqual({
    performance: {
      outputTokensPerSecond: null,
      timeToFirstOutputMs: null,
      speedTurns: "0",
      ttftTurns: "0",
    },
    groups: "5",
    turns: "7",
    inputTokens: "600",
    unknownInputGroups: "1",
    cachedInputTokens: "340",
    unknownCachedInputGroups: "0",
    outputTokens: "100",
    unknownOutputGroups: "0",
    totalTokens: "660",
    excludedTokenGroups: "1",
    cacheInputTokens: "600",
    cacheReadTokens: "330",
    nonCacheReadTokens: "270",
    cacheReadShare: 0.55,
    excludedCacheGroups: "1",
    estimatedCostUsd: "1.5",
    unknownCostGroups: "2",
    costCoverage: "partial",
  });
  expect(body.models.map((m) => m.model)).toStrictEqual([
    "unknown",
    "claude-sonnet-4-6",
    "unknown",
    "unknown",
  ]);
  expect(body.weekly.map((w) => [w.week, w.totalTokens])).toStrictEqual([
    ["2026-10-12", "110"],
    ["2026-10-19", "550"],
  ]);
  expect(body.daily[2].estimatedCostUsd).toBeNull();
  expect(body.daily[2].costCoverage).toBe("empty");
  expect(body.daily.at(-1)!.estimatedCostUsd).toBe("0");
  expect(body.daily.at(-1)!.unknownCostGroups).toBe("2");
  expect(body.availability).toStrictEqual({
    firstDay: "2020-01-01",
    lastDay: "2026-10-24",
    lastReceivedAt: "2026-10-25T00:00:00+00:00",
  });
  const sqlClient = await pool.connect();
  let executable;
  try {
    await sqlClient.query(
      `PREPARE dashboard_example(date,date,text,text) AS ${metricsSql}`,
    );
    executable = (
      await sqlClient.query(
        "EXECUTE dashboard_example('2026-10-18','2026-10-24',NULL,NULL)",
      )
    ).rows[0].metrics;
    await sqlClient.query("DEALLOCATE dashboard_example");
  } finally {
    sqlClient.release();
  }
  expect(body).toStrictEqual(executable);
  expect(JSON.stringify(body)).not.toMatch(
    /00000000|install_id|app_version|linux|1\.0\.0/,
  );
  const old = (await (
    await get("from=2020-01-01&to=2020-01-01")
  ).json()) as TelemetryMetrics;
  expect(old.totals.totalTokens).toBe("1100");
  expect(old.overview.participatingInstalls).toBe("1");
  const long = (await (
    await get("from=2020-01-01&to=2026-10-24")
  ).json()) as TelemetryMetrics;
  expect(long.activity).toHaveLength(2489);
  expect(long.totals.totalTokens).toBe("1760");
  if (process.env.TELEMETRY_METRICS_EVIDENCE)
    await writeFile(
      process.env.TELEMETRY_METRICS_EVIDENCE,
      JSON.stringify({ metrics: body, oldHistory: old }, null, 2),
    );
});
it("filters only usage, preserves nulls and replaces removed groups without inflating installs", async () => {
  const filtered = (await (
    await get(range + "&provider=codex&model=unknown")
  ).json()) as TelemetryMetrics;
  const global = (await (await get()).json()) as TelemetryMetrics;
  expect(filtered.overview).toStrictEqual(global.overview);
  expect(filtered.activity).toStrictEqual(global.activity);
  expect(filtered.totals.totalTokens).toBe("440");
  expect(filtered.totals.cacheReadShare).toBe(0.7);
  expect(filtered.models.map((m) => m.provider)).toStrictEqual(["codex"]);
  const none = (await (
    await get(range + "&provider=antigravity")
  ).json()) as TelemetryMetrics;
  expect(none.totals.estimatedCostUsd).toBe("0");
  expect(none.totals.cacheReadShare).toBeNull();
  const missing = (await (
    await get("from=2026-10-24&to=2026-10-24&provider=codex")
  ).json()) as TelemetryMetrics;
  expect(missing.totals.estimatedCostUsd).toBeNull();
  expect(missing.totals.costCoverage).toBe("unavailable");
  await new TelemetryStore(pool).replace({
    installId: "00000000-0000-4000-8000-000000000001",
    day: "2026-10-24",
    appVersion: "1.0.0",
    os: "linux",
    usage: [],
  });
  const changed = (await (await get()).json()) as TelemetryMetrics;
  expect(changed.overview).toStrictEqual(global.overview);
  expect(changed.totals.totalTokens).toBe("330");
  expect(changed.totals.unknownCostGroups).toBe("0");
  expect(changed.totals.costCoverage).toBe("complete");
  await new TelemetryStore(pool).replace({
    installId: "00000000-0000-4000-8000-000000000001",
    day: "2026-10-24",
    appVersion: "1.0.0",
    os: "linux",
    usage: [
      {
        provider: "codex",
        model: "unknown",
        turns: 1,
        inputTokens: 10,
        cachedInputTokens: 5,
        outputTokens: 2,
        estimatedCostUsd: 0.2,
      },
    ],
  });
  const corrected = (await (await get()).json()) as TelemetryMetrics;
  expect(corrected.overview).toStrictEqual(global.overview);
  expect(corrected.totals.totalTokens).toBe("342");
  expect(corrected.totals.estimatedCostUsd).toBe("1.7");
  expect(corrected.models.map((m) => [m.provider, m.model])).toStrictEqual([
    ["antigravity", "unknown"],
    ["claude", "claude-sonnet-4-6"],
    ["codex", "unknown"],
  ]);
});
it("bounds concurrent reads and database waits with generic recoverable failures", async () => {
  const blocker = await pool.connect();
  await blocker.query("BEGIN; LOCK usage_daily IN ACCESS EXCLUSIVE MODE");
  const pending = Array.from({ length: 4 }, () => get());
  try {
    for (let i = 0; i < 100; i++) {
      const result = await pool.query(
        "SELECT count(*) FROM pg_locks WHERE relation='usage_daily'::regclass AND NOT granted",
      );
      if (Number(result.rows[0].count) === 4) break;
      await pause(10);
    }
    const busy = await get();
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("1");
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  expect((await Promise.all(pending)).map((r) => r.status)).toStrictEqual([
    200, 200, 200, 200,
  ]);
  const lock = await pool.connect();
  await lock.query("BEGIN; LOCK usage_daily IN ACCESS EXCLUSIVE MODE");
  const start = Date.now();
  try {
    const timed = await get();
    expect(timed.status).toBe(503);
    expect(await timed.json()).toStrictEqual({ error: "unavailable" });
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
  }
  expect((await get()).status).toBe(200);
});
it("uses a read-only database role and bounds failures without exposing SQL or credentials", async () => {
  await pool.query(
    "CREATE ROLE metrics_read LOGIN; GRANT CONNECT ON DATABASE telemetry_test TO metrics_read; GRANT USAGE ON SCHEMA public TO metrics_read; GRANT SELECT ON installs,install_days,usage_daily TO metrics_read",
  );
  const url = new URL(db.url);
  url.username = "metrics_read";
  const read = createTelemetryPool(url.toString());
  try {
    const result = await read.query(metricsSql, [
      "2026-10-18",
      "2026-10-24",
      null,
      null,
    ]);
    expect(result.rows[0].metrics.overview.dau).toBe("3");
    await expect(read.query("DELETE FROM installs")).rejects.toThrow();
  } finally {
    await read.end();
  }
  await pool.query("ALTER TABLE usage_daily RENAME TO temporarily_unavailable");
  try {
    const r = await get();
    expect(r.status).toBe(503);
    expect(await r.json()).toStrictEqual({ error: "unavailable" });
  } finally {
    await pool.query(
      "ALTER TABLE temporarily_unavailable RENAME TO usage_daily",
    );
  }
  expect(() =>
    createMetricsServer({ pool, accessToken: "", consoleOrigin: origin }),
  ).toThrow();
  expect(() =>
    createMetricsServer({
      pool,
      accessToken: token,
      consoleOrigin: "https://console.invalid/path",
    }),
  ).toThrow();
});

it("preserves aggregate integers beyond JavaScript's exact numeric range", async () => {
  await pool.query("UPDATE usage_daily SET turns=9007199254740991");
  const metrics = (await (await get()).json()) as TelemetryMetrics;
  expect(metrics.totals.turns).toBe("45035996273704955");
});
it("returns explicit empty aggregates and the full accepted range without clipping", async () => {
  await pool.query("TRUNCATE usage_daily,install_days,installs");
  const from = new Date(Date.parse("2026-10-24") - 3659 * 86400000)
    .toISOString()
    .slice(0, 10);
  const response = await get(`from=${from}&to=2026-10-24`);
  expect(response.status).toBe(200);
  const empty = (await response.json()) as TelemetryMetrics;
  expect(empty.activity).toHaveLength(3660);
  expect(empty.daily).toHaveLength(3660);
  expect(empty.overview).toStrictEqual({
    participatingInstalls: "0",
    dau: "0",
    wau: "0",
    mau: "0",
    calendarMonthActives: "0",
  });
  expect(empty.models).toStrictEqual([]);
  expect(empty.totals.groups).toBe("0");
  expect(empty.totals.estimatedCostUsd).toBeNull();
  expect(empty.totals.costCoverage).toBe("empty");
  expect(empty.availability).toStrictEqual({
    firstDay: null,
    lastDay: null,
    lastReceivedAt: null,
  });
});

it("weights performance by measured output/time, preserves missing samples and replaces samples idempotently", async () => {
  await pool.query("TRUNCATE usage_daily,install_days,installs");
  const store = new TelemetryStore(pool);
  const payload = (
    id: string,
    performance?: {
      speedTurns: number;
      outputTokens: number;
      generationMs: number;
      ttftMs: number;
      ttftTurns: number;
    },
  ) => ({
    installId: `00000000-0000-4000-8000-00000000000${id}`,
    day: "2026-10-24",
    appVersion: "1.0.0",
    os: "macos" as const,
    usage: [
      {
        provider: "codex" as const,
        model: "gpt-6-sol" as const,
        turns: id === "1" ? 2 : 1,
        inputTokens: 1000,
        cachedInputTokens: 500,
        outputTokens: 100,
        estimatedCostUsd: null,
        ...(performance ? { performance } : {}),
      },
    ],
  });
  const first = payload("1", {
    speedTurns: 2,
    outputTokens: 100,
    generationMs: 4000,
    ttftMs: 1000,
    ttftTurns: 2,
  });
  await store.replace(first);
  await store.replace(
    payload("2", {
      speedTurns: 1,
      outputTokens: 100,
      generationMs: 1000,
      ttftMs: 3000,
      ttftTurns: 1,
    }),
  );
  await store.replace(payload("3"));
  await store.replace(first);
  let metrics = (await (await get()).json()) as TelemetryMetrics;
  expect(metrics.models).toHaveLength(1);
  expect(metrics.totals.performance).toStrictEqual({
    outputTokensPerSecond: "40",
    timeToFirstOutputMs: "1333.333",
    speedTurns: "3",
    ttftTurns: "3",
  });
  await store.replace(payload("1"));
  metrics = (await (await get()).json()) as TelemetryMetrics;
  expect(metrics.totals.performance).toStrictEqual({
    outputTokensPerSecond: "100",
    timeToFirstOutputMs: "3000",
    speedTurns: "1",
    ttftTurns: "1",
  });
});
