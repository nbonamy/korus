import { test } from "node:test";
import { telemetryStackWorkflow } from "./fixtures/telemetry-stack.mjs";

test(
  "telemetry infrastructure: database recovery, backup expiry and isolated restore",
  { timeout: 300000 },
  (t) => telemetryStackWorkflow(t, { infrastructure: true }),
);
