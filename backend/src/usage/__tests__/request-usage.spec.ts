import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type {
  ExecutionObservation,
  RequestObservation,
} from "@workspace/core/usage";
import { UsageLedger } from "../usage-ledger";
import { loadPricingHistory } from "../../pricing/catalog";

const at = Date.parse("2026-10-15T23:59:59Z");
const parent: ExecutionObservation = {
  provider: "claude",
  agentId: "a",
  sessionId: "s",
  turnId: "t",
  model: "turn-model",
  phase: "started",
  at,
};
const attribution = { teamId: "team", repository: "/repo" };
function request(patch: Partial<RequestObservation> = {}): RequestObservation {
  return {
    provider: "claude",
    agentId: "a",
    sessionId: "s",
    turnId: "t",
    requestId: "r",
    revision: 0,
    status: "final",
    at,
    apiProvider: "anthropic",
    model: "claude-sonnet-4-6",
    tokens: {
      input: 10000,
      output: 1000,
      cacheRead: 6000,
      cacheWrite: { "5m": 1000, "1h": 2000 },
      reasoning: 200,
      inputIncludesCacheRead: true,
      inputIncludesCacheWrite: true,
      outputIncludesReasoning: true,
    },
    pricingContext: { context: 10000, region: "global" },
    reportedServiceTier: "standard",
    requestedServiceTier: null,
    reportedMode: null,
    cacheMode: "explicit",
    modality: "text",
    ...patch,
  };
}
async function start(ledger: UsageLedger, event = parent) {
  await ledger.load();
  await ledger.observe(event, attribution);
}

it("prices Codex execution counters with cached reads, normal missing tiers and no context premium without inventing requests", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codex-cost-'));
  const file = path.join(dir, 'usage.sqlite');
  let ledger = new UsageLedger(file, () => at + 60000);
  const tokens = { input: 300000, output: 1000, cacheRead: 200000, cacheWrite: null, reasoning: 200 };
  const execution: ExecutionObservation = { ...parent, provider: 'codex', model: 'gpt-6-sol', tokens,
    requestCoverage: 'partial', requestCoverageReason: 'public-runtime-request-evidence-unavailable' };
  try {
    await start(ledger, { ...execution, turnId: 'normal' });
    await start(ledger, { ...execution, turnId: 'priority', serviceTier: 'priority' });
    expect(ledger.query().cost).toStrictEqual({ usd: 0.75, coverage: 'complete', requests: 0,
      pricedRequests: 0, unpricedRequests: 0, pricedExecutions: 2, unknownRequestExecutions: 0, reasons: [] });
    expect(ledger.query({ group: 'model', model: 'gpt-6-sol' }).rows[0]?.cost?.usd).toBe(0.75);
    expect(ledger.query({ apiProvider: 'openai', group: 'apiProvider' }).rows[0]?.cost?.usd).toBe(0.75);
    expect(ledger.query({ apiProvider: 'google' }).cost?.usd).toBeNull();
    await ledger.observe({ ...execution, turnId: 'normal', phase: 'usage', tokens: { ...tokens, output: 2000 } }, attribution);
    expect(ledger.query().cost?.usd).toBe(0.76);
    await ledger.close();
    ledger = new UsageLedger(file, () => at + 60000);
    await ledger.load();
    expect(ledger.query().cost?.usd).toBe(0.76);
    // Real request observations supersede the aggregate estimate rather than adding to it.
    await ledger.observeRequest(request({ provider: 'codex', turnId: 'priority', apiProvider: 'openai', model: 'gpt-6-sol',
      tokens: { ...request().tokens, input: 1000, output: 100, cacheRead: 0, cacheWrite: {}, reasoning: 0 },
      pricingContext: { context: 1000, region: null }, reportedServiceTier: 'standard', cacheMode: 'implicit' }));
    await ledger.observe({ ...execution, turnId: 'priority', phase: 'usage', requestCoverage: 'complete' }, attribution);
    expect(ledger.query().cost).toMatchObject({ usd: 0.263, requests: 1, pricedExecutions: 1, coverage: 'complete' });
    await start(ledger, { ...execution, turnId: 'zero', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: null } });
    await start(ledger, { ...execution, turnId: 'missing', model: null });
    expect(ledger.query().cost).toMatchObject({ usd: 0.263, coverage: 'partial', pricedExecutions: 2, unknownRequestExecutions: 1 });
    await ledger.clear();
    expect(ledger.query().cost).toMatchObject({ usd: null, requests: 0 });
  } finally { await ledger.close(); await rm(dir, { recursive: true, force: true }); }
});

// Failure modes: cache double counting/lifetime loss; turn-total double charging;
// wrong context inclusivity/category discount; stale replay; lost evidence at restart;
// grouping costs by parent model/day; legacy migration/cleanup losing token history.
it("prices disjoint cache lifetimes and reasoning once, replaces replayed samples across restart, and retains unknown legacy coverage", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "request-usage-"));
  const file = path.join(dir, "usage.sqlite");
  let ledger = new UsageLedger(file, () => at + 60000);
  try {
    await start(ledger);
    expect(await ledger.observeRequest(request())).toBe(true);
    await ledger.observe(
      {
        ...parent,
        phase: "completed",
        requestCoverage: "complete",
        tokens: { input: 999999, output: 999999, cacheRead: 0, cacheWrite: 0 },
      },
      attribution,
    );
    const expected = {
      usd: 0.03555,
      coverage: "complete",
      requests: 1,
      pricedRequests: 1,
      unpricedRequests: 0,
      unknownRequestExecutions: 0,
      reasons: [],
    };
    expect(ledger.query().cost).toStrictEqual(expected);
    await ledger.close();
    ledger = new UsageLedger(file, () => at + 60000);
    await ledger.load();
    expect(await ledger.observeRequest(request())).toBe(false);
    expect(
      await ledger.observeRequest(
        request({ revision: 1, status: "provisional" }),
      ),
    ).toBe(false);
    expect(
      await ledger.observeRequest(
        request({ revision: 1, tokens: { ...request().tokens, output: 2000 } }),
      ),
    ).toBe(true);
    expect(await ledger.observeRequest(request())).toBe(false);
    expect(ledger.query().cost).toMatchObject({ usd: 0.05055, requests: 1 });
    await ledger.observe({ ...parent, turnId: "legacy" }, attribution);
    expect(ledger.query().cost).toMatchObject({
      usd: 0.05055,
      coverage: "partial",
      unknownRequestExecutions: 1,
      reasons: [{ reason: "unknown-request-coverage", count: 1 }],
    });
    await ledger.clear();
    expect(ledger.query()).toMatchObject({
      rows: [],
      daily: [],
      cost: { usd: null, requests: 0 },
    });
    expect(await ledger.observeRequest(request({ revision: 2 }))).toBe(false);
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("uses strict context thresholds, served tiers and category-specific discounts before daily/model aggregation", async () => {
  const history = loadPricingHistory();
  const second = structuredClone(history[0]);
  second.date = "2026-10-16T00:00:00.000Z";
  second.google.find(
    (m) => m.id === "gemini-2.5-pro",
  )!.cost!.text!.output!.price = 20;
  const ledger = new UsageLedger(":memory:", () => at + 60000, [
    ...history,
    second,
  ]);
  try {
    await start(ledger);
    const base = request({
      apiProvider: "google",
      model: "gemini-2.5-pro",
      reportedServiceTier: "flex",
      cacheMode: "implicit",
      tokens: {
        input: 200000,
        output: 1000,
        cacheRead: 100000,
        cacheWrite: {},
        reasoning: 200,
        inputIncludesCacheRead: true,
        inputIncludesCacheWrite: true,
        outputIncludesReasoning: true,
      },
      pricingContext: { context: 200000, region: null },
    });
    await ledger.observeRequest(base);
    await ledger.observeRequest({
      ...base,
      requestId: "above",
      pricingContext: { context: 200001, region: null },
    });
    await ledger.observeRequest({
      ...base,
      requestId: "tomorrow",
      at: at + 1000,
    });
    await ledger.observeRequest(
      request({ requestId: "subagent", model: "claude-sonnet-4-6" }),
    );
    await ledger.observe(
      { ...parent, phase: "completed", requestCoverage: "complete" },
      attribution,
    );
    // At boundary: 100k*1.25*.5 + 100k*.125 + 1k*10*.5 = .08.
    // Above boundary: .125 + .025 + .0075 = .1575. New snapshot: .085.
    expect(ledger.query().cost).toMatchObject({
      usd: 0.35805,
      coverage: "complete",
      requests: 4,
    });
    const grouped = ledger.query({ group: "model" });
    expect(grouped.rows.find((r) => r.label === "turn-model")).toMatchObject({
      started: 1,
      cost: { usd: null, requests: 0 },
    });
    expect(
      grouped.rows.find((r) => r.label === "gemini-2.5-pro"),
    ).toMatchObject({ started: 0, cost: { usd: 0.3225, requests: 3 } });
    expect(grouped.daily).toMatchObject([
      { day: "2026-10-15", started: 1, cost: { usd: 0.27305, requests: 3 } },
      { day: "2026-10-16", started: 0, cost: { usd: 0.085, requests: 1 } },
    ]);
    expect(
      ledger.query({ from: "2026-10-16", model: "gemini-2.5-pro" }).cost,
    ).toMatchObject({ usd: 0.085, requests: 1 });
    expect(ledger.query({ provider: "codex" }).cost).toMatchObject({
      usd: null,
      requests: 0,
    });
    expect(
      ledger
        .query({ group: "apiProvider" })
        .rows.map((r) => [r.label, r.cost?.usd]),
    ).toEqual(
      expect.arrayContaining([
        ["google", 0.3225],
        ["anthropic", 0.03555],
      ]),
    );
    expect(
      ledger.query({ teamId: "team", repository: "/repo", agentId: "a" }).cost,
    ).toStrictEqual(ledger.query().cost);
  } finally {
    await ledger.close();
  }
});

it("leaves incomplete, provisional, unknown and pre-baseline requests unpriced while retaining genuine zero", async () => {
  const history = loadPricingHistory();
  const zero = structuredClone(history[0].anthropic[0]);
  zero.id = "zero";
  zero.cost = {
    text: {
      input: { unit: "token", price: 0 },
      output: { unit: "token", price: 0 },
    },
  };
  history[0].anthropic.push(zero);
  const ledger = new UsageLedger(":memory:", () => at, history);
  try {
    await start(ledger);
    const cases: [Partial<RequestObservation>, string][] = [
      [{ at: Date.parse("2026-09-30T23:59:59Z") }, "before-pricing-history"],
      [{ model: "unknown" }, "unknown-model"],
      [{ apiProvider: null }, "unknown-provider"],
      [
        { tokens: { ...request().tokens, cacheRead: null } },
        "missing-cache-usage",
      ],
      [
        { tokens: { ...request().tokens, cacheWrite: { unknown: 3000 } } },
        "missing-cache-rate",
      ],
      [
        {
          reportedServiceTier: null,
          requestedServiceTier: "priority",
          apiProvider: "google",
          model: "gemini-2.5-pro",
        },
        "missing-service-tier",
      ],
      [
        {
          reportedServiceTier: "auto",
          apiProvider: "google",
          model: "gemini-2.5-pro",
        },
        "unsupported-service-tier",
      ],
      [
        {
          pricingContext: { context: null, region: "global" },
          apiProvider: "google",
          model: "gemini-2.5-pro",
        },
        "missing-pricing-context",
      ],
      [
        { pricingContext: { context: 10000, region: null } },
        "missing-pricing-context",
      ],
      [{ status: "provisional" }, "provisional-usage"],
      [
        { tokens: { ...request().tokens, inputIncludesCacheRead: null } },
        "missing-token-semantics",
      ],
      [{ modality: null }, "unsupported-token-modality"],
      [{ model: "gpt-image-1", apiProvider: "openai" }, "unpriced-model"],
      [
        { tokens: { ...request().tokens, output: null } },
        "missing-token-usage",
      ],
      [
        { tokens: { ...request().tokens, input: 0 } },
        "inconsistent-token-usage",
      ],
      [{ cacheMode: null }, "missing-cache-usage"],
      [{ reportedMode: "unknown-mode" }, "unsupported-mode"],
    ];
    for (const [i, [patch, reason]] of cases.entries()) {
      await ledger.observeRequest(request({ requestId: `bad-${i}`, ...patch }));
      expect(ledger.query().cost?.reasons).toContainEqual({
        reason,
        count: cases.slice(0, i + 1).filter((c) => c[1] === reason).length,
      });
    }
    await ledger.observe(
      { ...parent, phase: "completed", requestCoverage: "complete" },
      attribution,
    );
    expect(ledger.query().cost).toMatchObject({
      usd: null,
      coverage: "unavailable",
      requests: cases.length,
      unpricedRequests: cases.length,
    });
    await ledger.observeRequest(
      request({
        requestId: "free",
        model: "zero",
        tokens: { ...request().tokens, cacheRead: 0, cacheWrite: {} },
      }),
    );
    expect(ledger.query().cost).toMatchObject({
      usd: 0,
      coverage: "partial",
      pricedRequests: 1,
    });
    await ledger.observeRequest(
      request({
        requestId: "baseline",
        at: Date.parse("2026-10-01T00:00:00Z"),
      }),
    );
    expect(
      ledger.query({ from: "2026-10-01", to: "2026-10-01" }).cost,
    ).toMatchObject({ usd: 0.03555, coverage: "complete", requests: 1 });
  } finally {
    await ledger.close();
  }
});

it("migrates legacy SQLite without losing tokens/timing and deletes retained request evidence with its parent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "request-migration-"));
  const file = path.join(dir, "usage.sqlite");
  let now = at;
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE executions(provider TEXT,session_id TEXT,turn_id TEXT,agent_id TEXT,model TEXT,reasoning_effort TEXT,service_tier TEXT,team_id TEXT,repository TEXT,phase TEXT,started_at INTEGER,updated_at INTEGER,duration_ms INTEGER,tokens TEXT,timing TEXT,PRIMARY KEY(provider,session_id,turn_id))",
  );
  db.prepare(
    "INSERT INTO executions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "claude",
    "s",
    "t",
    "a",
    "legacy",
    null,
    null,
    "team",
    "/repo",
    "completed",
    at,
    at,
    1000,
    JSON.stringify({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }),
    JSON.stringify({ activeMs: 1000, ttftMs: 100 }),
  );
  db.close();
  const ledger = new UsageLedger(file, () => now);
  try {
    await ledger.load();
    expect(ledger.query().rows[0]).toMatchObject({
      tokens: { input: 10, output: 5 },
      speed: { outputTokens: 5, generationMs: 900 },
    });
    expect(ledger.query().cost).toMatchObject({
      usd: null,
      unknownRequestExecutions: 1,
    });
    await ledger.observeRequest(request());
    await ledger.deleteExecution("claude", "s", "t");
    expect(ledger.query().cost).toMatchObject({ requests: 0 });
    await start(ledger);
    await ledger.observeRequest(request());
    now += 366 * 86400000;
    await ledger.load();
    expect(ledger.query().cost).toMatchObject({
      requests: 0,
      unknownRequestExecutions: 0,
    });
    await ledger.close();
    const check = new DatabaseSync(file);
    expect(check.prepare("SELECT COUNT(*) AS n FROM requests").get()?.n).toBe(
      0,
    );
    check.close();
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("composes long-context and priority prices, served-mode rates and exclusive token semantics", async () => {
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await start(ledger);
    const tokens = {
      input: 10000,
      output: 1000,
      cacheRead: 6000,
      cacheWrite: {},
      reasoning: 200,
      inputIncludesCacheRead: true,
      inputIncludesCacheWrite: true,
      outputIncludesReasoning: true,
    };
    const base = request({
      apiProvider: "openai",
      model: "gpt-6-sol",
      tokens,
      reportedServiceTier: "priority",
      requestedServiceTier: "flex",
      cacheMode: "implicit",
    });
    for (const [requestId, context, usd] of [
      ["below", 271999, 0.0384],
      ["equal", 272000, 0.0384],
      ["above", 272001, 0.0668],
    ] as const) {
      await ledger.observeRequest({
        ...base,
        requestId,
        pricingContext: { context, region: null },
      });
      expect(ledger.query({ model: "gpt-6-sol" }).cost?.usd).toBeCloseTo(
        requestId === "below" ? usd : requestId === "equal" ? 0.0768 : 0.1436,
        12,
      );
    }
    await ledger.observeRequest({
      ...base,
      requestId: "mode",
      model: "o4-mini",
      reportedServiceTier: "priority",
    });
    expect(ledger.query({ model: "o4-mini" }).cost).toMatchObject({
      usd: 0.019,
      coverage: "complete",
    });
    const exclusive = request({
      requestId: "exclusive",
      tokens: {
        ...request().tokens,
        input: 1000,
        output: 800,
        inputIncludesCacheRead: false,
        inputIncludesCacheWrite: false,
        outputIncludesReasoning: false,
      },
    });
    await ledger.observeRequest(exclusive);
    expect(ledger.query({ model: exclusive.model! }).cost).toMatchObject({
      usd: 0.03555,
    });
    await ledger.observeRequest({
      ...exclusive,
      requestId: "regional",
      pricingContext: { context: 10000, region: "us" },
    });
    expect(ledger.query({ model: exclusive.model! }).cost?.usd).toBeCloseTo(
      0.03555 * 2.1,
      12,
    );
    await ledger.observeRequest({
      ...base,
      requestId: "documented",
      reportedServiceTier: null,
      defaultServiceTier: {
        tier: "standard",
        source: "https://provider.example/default-tier",
      },
      pricingContext: { context: 10000, region: null },
    });
    expect(ledger.query().cost?.pricedRequests).toBe(7);
  } finally {
    await ledger.close();
  }
});

it("rejects invalid/orphaned samples and identity changes, permits provisional finalization and scopes retries by session and turn", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "request-identity-"));
  const file = path.join(dir, "usage.sqlite");
  let ledger = new UsageLedger(file, () => at);
  try {
    await start(ledger);
    expect(await ledger.observeRequest(request({ turnId: "orphan" }))).toBe(
      false,
    );
    expect(await ledger.observeRequest(request({ agentId: "wrong" }))).toBe(
      false,
    );
    expect(
      await ledger.observeRequest({
        ...request(),
        prompt: "CONTENT_CANARY",
      } as RequestObservation),
    ).toBe(false);
    expect(await ledger.observeRequest(request({ at: at + 60001 }))).toBe(
      false,
    );
    expect(
      await ledger.observeRequest(request({ status: "provisional" })),
    ).toBe(true);
    await ledger.close();
    ledger = new UsageLedger(file, () => at);
    await ledger.load();
    expect(
      await ledger.observeRequest(request({ revision: 1, at: at - 1 })),
    ).toBe(false);
    expect(await ledger.observeRequest(request({ revision: 1 }))).toBe(true);
    expect(
      await ledger.observeRequest(
        request({ revision: 1, model: "changed-without-revision" }),
      ),
    ).toBe(false);
    for (const patch of [
      { requestId: "retry" },
      { turnId: "other" },
      { sessionId: "other" },
    ]) {
      await ledger.observe({ ...parent, ...patch }, attribution);
      expect(await ledger.observeRequest(request(patch))).toBe(true);
    }
    expect(ledger.query().cost).toMatchObject({
      requests: 4,
      pricedRequests: 4,
      unknownRequestExecutions: 3,
    });
    await ledger.close();
    const check = new DatabaseSync(file);
    expect(
      check
        .prepare("SELECT observation FROM requests")
        .all()
        .some((row) => String(row.observation).includes("CONTENT_CANARY")),
    ).toBe(false);
    check.close();
  } finally {
    await ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("honors ordered predicate composition and explicit-cache/reasoning overrides without discounting unrelated categories", async () => {
  const history = loadPricingHistory();
  const model = history[0].anthropic.find((m) => m.id === "claude-sonnet-4-6")!;
  model.cost = {
    text: {
      input: {
        unit: "token",
        price: 1,
        cache: {
          read: 1,
          write: { "5m": 2 },
          explicit: { read: 2, write: { "5m": 4 } },
        },
        overrides: [
          {
            when: {
              all: [{ context: { gte: 10000 } }, { context: { lte: 10000 } }],
            },
            price: 2,
          },
          {
            when: {
              any: [
                { context: { lt: 10000 } },
                { not: { region: { in: ["us", "global"] } } },
              ],
            },
            price: 5,
          },
          {
            when: { date: { gte: "2026-10-15" } },
            cache: { explicit: { read: 3 } },
          },
        ],
      },
      output: { unit: "token", price: 10, reasoning: 20 },
    },
    multipliers: [
      {
        when: { region: { equals: "global" } },
        factor: { text: { input: { price: 0.5 } } },
      },
    ],
  };
  const ledger = new UsageLedger(":memory:", () => at, history);
  try {
    await start(ledger);
    await ledger.observeRequest(
      request({ tokens: { ...request().tokens, cacheWrite: { "5m": 3000 } } }),
    );
    // 1k*2*.5 + 6k*3 + 3k*4 + 800*10 + 200*20.
    expect(ledger.query().cost).toMatchObject({
      usd: 0.043,
      pricedRequests: 1,
    });
  } finally {
    await ledger.close();
  }
});

it("uses a reported served mode to resolve its authored tier, and rejects a conflicting reported tier", async () => {
  const ledger = new UsageLedger(":memory:", () => at);
  try {
    await start(ledger);
    const mode = request({
      apiProvider: "openai",
      model: "o4-mini",
      reportedMode: "fast",
      reportedServiceTier: null,
      requestedServiceTier: "flex",
      cacheMode: "implicit",
      tokens: { ...request().tokens, cacheWrite: {} },
    });
    await ledger.observeRequest(mode);
    expect(ledger.query().cost).toMatchObject({
      usd: 0.019,
      pricedRequests: 1,
    });
    await ledger.observeRequest({
      ...mode,
      requestId: "conflict",
      reportedServiceTier: "flex",
    });
    expect(ledger.query().cost).toMatchObject({
      usd: 0.019,
      unpricedRequests: 1,
      reasons: expect.arrayContaining([
        { reason: "unsupported-service-tier", count: 1 },
      ]),
    });
  } finally {
    await ledger.close();
  }
});
