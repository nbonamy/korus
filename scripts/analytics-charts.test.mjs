import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const exec = promisify(execFile);
test(
  "desktop and console render Chart.js gaps, units, inspection and responsive layouts",
  { timeout: 90000 },
  async (t) => {
    const out = await mkdtemp(
      path.join(os.tmpdir(), "analytics-chart-browser-"),
    );
    await exec(
      process.execPath,
      ["scripts/analytics-charts.browser.mjs", "--out", out],
      { timeout: 85000, maxBuffer: 1000000 },
    );
    const receipt = JSON.parse(
      await readFile(path.join(out, "receipt.json"), "utf8"),
    );
    assert.deepEqual(receipt.errors, []);
    assert.equal(receipt.captures.length, 18);
    t.diagnostic(`Desktop screenshot evidence: ${out}`);
  },
);
