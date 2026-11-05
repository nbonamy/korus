import { spawnSync } from "node:child_process";
import { it } from "vitest";
import { telemetryStackWorkflow } from "../../../test/e2e/fixtures/telemetry-stack.mjs";

const dockerRunning = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 20_000 }).status === 0;

// The stack workflow reports its steps as node:test subtests; vitest has none, so run them in order
// and name the step that failed.
const steps = {
  async test(name, optionsOrFn, maybeFn) {
    const run = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
    try {
      await run(steps);
    } catch (error) {
      if (error instanceof Error) error.message = `[${name}] ${error.message}`;
      throw error;
    }
  },
};

// Real built console behind authenticated nginx, a read service and seeded Postgres, in Chromium. Needs a
// running Docker engine, so it is skipped where there is none.
it.skipIf(!dockerRunning)("console: authenticated reports, corrections and responsive layout", () => telemetryStackWorkflow(steps), 180_000);
