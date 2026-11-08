import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "vitest";

const exec = promisify(execFile);

// Desktop usage charts and the operator console's charts, rendered in Chromium: gaps, units, inspection
// and responsive layouts. The capture script also serves before/after comparisons (see its options).
test("desktop and console render Chart.js gaps, units, inspection and responsive layouts", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "analytics-chart-browser-"));
  await exec(process.execPath, [path.join(import.meta.dirname, "../../scripts/analytics-charts.browser.mjs"), "--out", out], { timeout: 85_000, maxBuffer: 1_000_000 });
  const receipt = JSON.parse(await readFile(path.join(out, "receipt.json"), "utf8"));
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.captures.length, 18);
  console.info(`Desktop screenshot evidence: ${out}`);
});
