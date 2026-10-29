import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Failure modes: absent/malformed bearer or a partial relay override starts a network
// request, exits successfully, loses the failure artifact, or prints private inputs.
for (const [name, input] of [
  ["missing invitation", { TEST_SHARED_LINK: "" }],
  [
    "malformed invitation",
    { TEST_SHARED_LINK: "PRIVATE_INVALID_INVITATION_CANARY" },
  ],
  [
    "partial relay override",
    {
      TEST_SHARED_LINK: "PRIVATE_INVITATION_CANARY",
      APP_COMPANION_RELAY_URL: "wss://PRIVATE_RELAY_CANARY.example",
    },
  ],
]) {
  test(`shared-chat runner reports ${name} without exposing its inputs`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shared-chat-probe-"));
    try {
      const report = path.join(directory, "results.json");
      const summary = path.join(directory, "summary.md");
      const child = spawnSync(
        process.execPath,
        ["scripts/shared-chat-probe.mjs", report],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...process.env,
            TEST_SHARED_LINK: "",
            APP_COMPANION_RELAY_URL: "",
            APP_COMPANION_RELAY_PEER_ID: "",
            ...input,
            GITHUB_STEP_SUMMARY: summary,
          },
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1);
      const result = JSON.parse(await readFile(report, "utf8"));
      assert.equal(typeof result.error, "string");
      assert.deepEqual(result, {
        status: "failed",
        stage: "configuration",
        error: result.error,
      });
      assert.deepEqual(JSON.parse(child.stdout), result);
      const output =
        child.stdout + child.stderr + (await readFile(summary, "utf8"));
      assert.equal(output.includes("PRIVATE_"), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
