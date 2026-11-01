import { expect, it } from "vitest";
import { isUtcDay, utcDay, validExecutionTiming } from "../usage";
import {
  serializeDailyTelemetry,
  normalizeTelemetryVersion,
  telemetryOs,
} from "../telemetry";

// Wire-boundary failures: extra fields, aliases, unsafe/unknown numbers, duplicate
// groups and insertion-order drift must never become sealed telemetry bytes.
it("seals only the closed telemetry contract in canonical order and preserves null and measured zero", () => {
  const group = {
    provider: "codex" as const,
    model: "gpt-6-sol" as const,
    turns: 1,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
  };
  const payload = {
    installId: "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f",
    day: "2026-10-15",
    appVersion: "0.44.0",
    os: "macos" as const,
    usage: [group],
  };
  expect(serializeDailyTelemetry({ ...payload, usage: [] }).body).toBe(
    '{"installId":"d8b65ff5-179c-49b9-ac3a-f60a54a0f43f","day":"2026-10-15","appVersion":"0.44.0","os":"macos","usage":[]}',
  );
  expect(serializeDailyTelemetry(payload)).toStrictEqual({
    body: '{"installId":"d8b65ff5-179c-49b9-ac3a-f60a54a0f43f","day":"2026-10-15","appVersion":"0.44.0","os":"macos","usage":[{"provider":"codex","model":"gpt-6-sol","turns":1,"inputTokens":null,"cachedInputTokens":null,"outputTokens":null,"estimatedCostUsd":null}]}',
  });
  const zero = {
    ...group,
    provider: "claude" as const,
    model: "unknown" as const,
    turns: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
  const body = serializeDailyTelemetry({
    ...payload,
    usage: [group, zero],
  }).body;
  expect(JSON.parse(body).usage).toStrictEqual([zero, group]);
  expect(
    serializeDailyTelemetry({ ...payload, usage: [zero, group] }).body,
  ).toBe(body);
  for (const patch of [
    { prompt: "CANARY" },
    { installId: "account" },
    { day: "2026-02-29" },
    { appVersion: "0.44.0-local" },
    { os: "darwin" },
    { usage: [group, group] },
    { usage: [{ ...group, model: "private-alias" }] },
    { usage: [{ ...group, provider: "proxy-alias" }] },
    { usage: [{ ...group, path: "CANARY" }] },
    { usage: [{ ...group, inputTokens: 1, cachedInputTokens: 2 }] },
    { usage: [{ ...group, turns: Number.MAX_SAFE_INTEGER + 1 }] },
    { usage: [{ ...group, outputTokens: -1 }] },
    { usage: [{ ...group, estimatedCostUsd: Infinity }] },
  ])
    expect(() =>
      serializeDailyTelemetry({ ...payload, ...patch } as typeof payload),
    ).toThrow();
  expect(normalizeTelemetryVersion("0.44.0-beta.2+private-build")).toBe(
    "0.44.0",
  );
  expect(() => normalizeTelemetryVersion("private-version")).toThrow();
  expect(
    ["darwin", "win32", "linux", "freebsd"].map(telemetryOs),
  ).toStrictEqual(["macos", "windows", "linux", "unknown"]);
});

it("groups timestamps by UTC day and rejects normalized or invalid calendar filters", () => {
  expect(utcDay(Date.parse("2026-10-15T23:30:00-05:00"))).toBe("2026-10-16");
  expect(isUtcDay("2024-02-29")).toBe(true);
  for (const day of [
    "2026-02-29",
    "2026-13-01",
    "2026-10-15T00:00:00Z",
    " 2026-10-15",
    "2026-1-1",
    null,
  ])
    expect(isUtcDay(day)).toBe(false);
});
it("accepts bounded timing and rejects empty spans, a first output after the end, unsafe numbers and extra properties", () => {
  expect(validExecutionTiming({ activeMs: 1000, ttftMs: 200 })).toBe(true);
  expect(validExecutionTiming({ activeMs: 1000, ttftMs: null })).toBe(true);
  for (const value of [
    null,
    [],
    { activeMs: 0, ttftMs: null },
    { activeMs: 1000, ttftMs: 1001 },
    { activeMs: 1000, ttftMs: -1 },
    { activeMs: 1.5, ttftMs: null },
    { activeMs: 1000 },
    { activeMs: 1000, ttftMs: null, content: "private" },
  ])
    expect(validExecutionTiming(value)).toBe(false);
});

it("validates request measurements without accepting content, unsafe counts or ambiguous update identities", async () => {
  const { validRequestObservation } = await import("../usage");
  const value = {
    provider: "codex",
    agentId: "a",
    sessionId: "s",
    turnId: "t",
    requestId: "r",
    at: 1,
    revision: 0,
    status: "final",
    apiProvider: "openai",
    model: "gpt-6-sol",
    modality: "text",
    cacheMode: "implicit",
    requestedServiceTier: "priority",
    reportedServiceTier: null,
    reportedMode: null,
    pricingContext: { context: null, region: null },
    tokens: {
      input: 0,
      output: 0,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
      inputIncludesCacheRead: null,
      inputIncludesCacheWrite: null,
      outputIncludesReasoning: null,
    },
  };
  expect(validRequestObservation(value)).toBe(true);
  expect(
    validRequestObservation({
      ...value,
      defaultServiceTier: {
        tier: "standard",
        source: "https://provider.example/tier-default",
      },
    }),
  ).toBe(true);
  for (const patch of [
    { prompt: "content" },
    { provider: "unknown" },
    { requestId: "" },
    { revision: -1 },
    { revision: 1.5 },
    { at: NaN },
    { status: "complete" },
    { apiProvider: "codex" },
    { pricingContext: { prompt: "content" } },
    { tokens: { ...value.tokens, input: -1 } },
    { tokens: { ...value.tokens, cacheWrite: { "5m": Infinity } } },
    { tokens: { ...value.tokens, inputIncludesCacheRead: "yes" } },
    { tokens: { ...value.tokens, content: "private" } },
  ])
    expect(validRequestObservation({ ...value, ...patch })).toBe(false);
});

it("seals only additive performance samples, rejecting content and inconsistent counts", () => {
  const performance = {
    speedTurns: 2,
    outputTokens: 100,
    generationMs: 4000,
    ttftMs: 1000,
    ttftTurns: 2,
  };
  const row = {
    provider: "codex" as const,
    model: "gpt-6-sol" as const,
    turns: 3,
    inputTokens: 1000,
    cachedInputTokens: 500,
    outputTokens: 100,
    estimatedCostUsd: null,
    performance,
  };
  const payload = {
    installId: "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f",
    day: "2026-10-15",
    appVersion: "1.0.0",
    os: "macos" as const,
    usage: [row],
  };
  expect(
    JSON.parse(serializeDailyTelemetry(payload).body).usage[0].performance,
  ).toStrictEqual(performance);
  for (const invalid of [
    { ...performance, prompt: "CANARY" },
    { ...performance, speedTurns: 4 },
    { ...performance, generationMs: 0 },
    { ...performance, ttftTurns: 0 },
    { ...performance, ttftMs: -1 },
  ])
    expect(() =>
      serializeDailyTelemetry({
        ...payload,
        usage: [{ ...row, performance: invalid }],
      }),
    ).toThrow();
});
