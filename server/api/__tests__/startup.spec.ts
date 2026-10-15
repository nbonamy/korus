import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it("loads private deployment configuration, answers health checks and closes its listener on shutdown", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "korus-api-startup-"));
  dirs.push(dir);
  const token = path.join(dir, "operator-token");
  await writeFile(token, "isolated-startup-test-operator-token-only", {
    mode: 0o600,
  });
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  vi.stubEnv("API_OPERATOR_TOKEN_FILE", token);
  vi.stubEnv("API_TELEMETRY_DATABASE", path.join(dir, "db"));
  vi.stubEnv("API_HOST", "127.0.0.1");
  vi.stubEnv("API_PORT", String(port));
  vi.stubEnv("API_SYNTHETIC", "1");
  vi.stubEnv("API_REVERSE_PROXY", "");
  vi.stubEnv("API_TLS_KEY", "");
  vi.stubEnv("API_TLS_CERT", "");
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  const previous = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
  };
  try {
    await import("../main");
    expect(
      await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
        response.json(),
      ),
    ).toStrictEqual({ status: "ok" });
    const shutdown = process
      .listeners("SIGTERM")
      .find((handler) => !previous.SIGTERM.includes(handler));
    expect(shutdown).toBeDefined();
    shutdown!("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      for (const handler of process.listeners(signal))
        if (!previous[signal].includes(handler))
          process.removeListener(signal, handler);
  }
});

it("fails closed on unreadable secret files without logging paths or credentials", async () => {
  vi.stubEnv("API_OPERATOR_TOKEN_FILE", "/CANARY_PRIVATE_LOCATION/missing");
  const write = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const prior = process.exitCode;
  try {
    await import("../main");
    expect(process.exitCode).toBe(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(
      "API server configuration or startup failed.\n",
    );
  } finally {
    process.exitCode = prior;
  }
});
