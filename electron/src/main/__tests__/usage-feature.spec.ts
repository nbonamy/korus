import { expect, it, vi } from "vitest";
import { observeUsageFeature } from "../usage-feature";
import { backendMethods } from "@workspace/core/backend-protocol/methods";
it("observes native completion and failure without forwarding operation content or preventing work when reporting is unavailable", async () => {
  const request = vi.fn(async (method: string) =>
    method === backendMethods.telemetryFeatureBegin ? "local-id" : undefined,
  );
  const backend = { request: request as never };
  expect(
    await observeUsageFeature(
      backend,
      "browser.open",
      async () => "/CANARY_URL",
    ),
  ).toBe("/CANARY_URL");
  await expect(
    observeUsageFeature(backend, "browser.open", async () => {
      throw new Error("CANARY_error");
    }),
  ).rejects.toThrow("CANARY_error");
  expect(request.mock.calls).toHaveLength(4);
  expect(JSON.stringify(request.mock.calls)).not.toContain("CANARY");
  expect(request).toHaveBeenLastCalledWith(
    backendMethods.telemetryFeatureFinish,
    { operationId: "local-id", outcome: "failed" },
  );
  const unavailable = {
    request: vi.fn(async () => {
      throw Error("unavailable");
    }) as never,
  };
  expect(
    await observeUsageFeature(unavailable, "browser.open", async () => 42),
  ).toBe(42);
});
it("captures native observation permission before execution and isolates failed or late telemetry callbacks", async () => {
  const { speechOperationObserver } = await import("../usage-feature");
  let permission: number | null = null;
  let resolve!: (value: string | null) => void;
  const pending = new Promise<string | null>((r) => (resolve = r));
  const request = vi.fn(async (method: string) =>
    method === backendMethods.telemetryFeatureBegin ? pending : undefined,
  );
  const observe = speechOperationObserver(
    () => ({ request: request as never }),
    () => permission,
  );
  expect(observe("start")).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
  permission = 1;
  const finish = observe("start")!;
  finish("succeeded");
  finish("failed");
  permission = 2;
  resolve("old-local-id");
  await Promise.resolve();
  await Promise.resolve();
  expect(request).not.toHaveBeenCalledWith(
    backendMethods.telemetryFeatureFinish,
    expect.anything(),
  );
  const enabledRequest = vi.fn(async (method: string) =>
    method === backendMethods.telemetryFeatureBegin
      ? "new-local-id"
      : undefined,
  );
  const enabled = speechOperationObserver(
    () => ({ request: enabledRequest as never }),
    () => permission,
  );
  enabled("cancel")!("cancelled");
  await vi.waitFor(() =>
    expect(enabledRequest).toHaveBeenCalledWith(
      backendMethods.telemetryFeatureFinish,
      { operationId: "new-local-id", outcome: "cancelled" },
    ),
  );
  const unavailable = speechOperationObserver(
    () => ({
      request: vi.fn(async () => {
        throw Error("CANARY_unavailable");
      }) as never,
    }),
    () => permission,
  );
  expect(() => unavailable("stop")!("failed")).not.toThrow();
  await Promise.resolve();
});

it("observes named viewport/capture completions while excluding page interactions", async () => {
  const { observeBrowserCommand } = await import("../usage-feature");
  const request = vi.fn(async (method: string) =>
    method === backendMethods.telemetryFeatureBegin ? "local-id" : undefined,
  );
  const backend = { request: request as never };
  expect(
    await observeBrowserCommand(backend, "type", async () => "CANARY_content"),
  ).toBe("CANARY_content");
  expect(request).not.toHaveBeenCalled();
  await observeBrowserCommand(backend, "viewport", async () => ({
    width: 400,
  }));
  await expect(
    observeBrowserCommand(backend, "screenshot", async () => {
      throw Error("CANARY_capture_error");
    }),
  ).rejects.toThrow("CANARY_capture_error");
  expect(request).toHaveBeenCalledWith(backendMethods.telemetryFeatureBegin, {
    feature: "browser.responsive",
  });
  expect(request).toHaveBeenCalledWith(backendMethods.telemetryFeatureBegin, {
    feature: "browser.capture",
  });
  expect(request).toHaveBeenLastCalledWith(
    backendMethods.telemetryFeatureFinish,
    { operationId: "local-id", outcome: "failed" },
  );
  expect(JSON.stringify(request.mock.calls)).not.toContain("CANARY");
});
