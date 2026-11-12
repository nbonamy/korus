import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { providerNeutralityViolations } from "./check-provider-neutrality.mjs";

async function check(files) {
  const root = await mkdtemp(path.join(tmpdir(), "provider-neutrality-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    return await providerNeutralityViolations(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("flags a provider named in shared code, and an import of a provider entry", async () => {
  const violations = await check({
    "client/vue/src/pane.ts": "export const isCodex = (provider: string) => provider === 'codex';",
    "core/src/types.ts": "import type { CodexAccount } from '@korus-dev/multi-agent-sdk/codex';",
  });
  assert.equal(violations.length, 2);
  assert.match(violations.join("\n"), /pane.ts:1: names a provider/);
  assert.match(violations.join("\n"), /imports a provider entry/);
});

test("allows setup, persistence, tests, comments and property names", async () => {
  const violations = await check({
    "client/backend/src/codex/provider-update.ts": "export const executable = 'codex';",
    "client/backend/src/persistence/schema.ts": "export const kind = 'claude';",
    "client/vue/src/__tests__/pane.spec.ts": "const provider = 'cursor';",
    "core/src/notes.ts": "// Antigravity installs itself: 'antigravity'\nexport const page = (input: Record<string, string>) => input['cursor'];",
  });
  assert.deepEqual(violations, []);
});
