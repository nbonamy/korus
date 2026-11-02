import { test } from "node:test";
import { telemetryStackWorkflow } from "./fixtures/telemetry-stack.mjs";

test(
  "console: authenticated reports, corrections and responsive layout",
  { timeout: 120000 },
  (t) => telemetryStackWorkflow(t),
);
