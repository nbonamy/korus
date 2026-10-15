import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it, vi } from "vitest";
import { createComputerUseToolModuleProvider } from "../../mcp/adapter-tool-modules";
import { TelemetryReporter } from "../reporter";
import { UsageService } from "../usage-service";
import { UsageLedger } from "../usage-ledger";

it("counts actual Computer Use operations under the initiating execution permission, without content or replay attribution", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "computer-usage-"));
  const reporter = new TelemetryReporter(path.join(dir, "queue"), {
    rollout: true,
    forceOff: false,
    environment: true,
    endpoint: "http://127.0.0.1:1/reports",
    synthetic: true,
    version: "0.33.0",
    channel: "stable",
    platform: "macos",
    client: "daemon",
  });
  const ledger = new UsageLedger(path.join(dir, "local"));
  const usage = new UsageService(ledger, reporter, () => undefined);
  const execute = vi
    .fn()
    .mockResolvedValue({ ok: true, result: { text: "CANARY_SCREEN_CONTENT" } });
  const handlers = new Map<string, (input: object) => Promise<unknown>>();
  const server = {
    registerTool: (
      name: string,
      _definition: unknown,
      handler: (input: object) => Promise<unknown>,
    ) => handlers.set(name, handler),
  } as unknown as McpServer;
  try {
    await ledger.load();
    await reporter.load();
    await reporter.choose("desktop", { enabled: true, disclosure: 2 });
    const module = createComputerUseToolModuleProvider(
      {
        execute,
        status: vi.fn(),
        stop: vi.fn(),
        requestAccessibility: vi.fn(),
      },
      () => true,
      (id) => usage.featuresForAgent(id),
    ).resolve({ agentId: "agent", url: new URL("http://127.0.0.1/mcp") })!;
    module.register(server, { proposedActions: true });
    const call = () => handlers.get("computer-use-list-apps")!({});
    expect(
      await usage.beginClientFeature("desktop", "browser.open", "agent"),
    ).toBeNull();
    await call(); // Tool availability/history does not establish live source permission.
    await reporter.drain();
    expect(reporter.privacy("desktop").pending).toStrictEqual([]);
    const event = {
      agentId: "agent",
      sessionId: "session",
      turnId: "turn",
      provider: "claude" as const,
      phase: "started" as const,
      at: Date.now(),
      model: null,
    };
    usage.source("agent", "desktop");
    usage.observe(event);
    await usage.drain();
    await call();
    await reporter.drain();
    expect(
      reporter
        .privacy("desktop")
        .pending.filter((batch) => batch.family === "feature")
        .flatMap((batch) => batch.rows)
        .map((row) => [row.feature, row.metric, row.value]),
    ).toStrictEqual([
      ["computer.use", "feature.attempted", 1],
      ["computer.use", "feature.succeeded", 1],
    ]);
    expect(JSON.stringify(reporter.privacy("desktop").pending)).not.toContain(
      "CANARY",
    );
    const browser = await usage.beginClientFeature(
      "desktop",
      "browser.open",
      "agent",
    );
    expect(browser).not.toBeNull();
    await reporter.finishFeature("desktop", browser!, "succeeded");
    let finish!: (result: object) => void;
    execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = call();
    await reporter.choose("desktop", { enabled: false, disclosure: 2 });
    await reporter.choose("desktop", { enabled: true, disclosure: 2 });
    finish({ ok: true, result: "CANARY_LATE_CONTENT" });
    await pending;
    expect(
      await usage.beginClientFeature("desktop", "browser.open", "agent"),
    ).toBeNull();
    await call(); // Re-enabling cannot revive permission of an already running turn.
    await reporter.drain();
    expect(execute).toHaveBeenCalledTimes(4);
    expect(reporter.privacy("desktop").pending).toStrictEqual([]);
  } finally {
    await usage.close();
    await rm(dir, { recursive: true, force: true });
  }
});
