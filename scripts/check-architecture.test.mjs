import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("./check-architecture.mjs", import.meta.url),
);
const directories = [
  "core/src",
  "backend/src",
  "electron/src/main",
  "electron/src/preload",
  "mobile/src",
];

async function checkFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "app-architecture-"));
  try {
    await Promise.all(
      directories.map((directory) =>
        mkdir(path.join(root, directory), { recursive: true }),
      ),
    );
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("architecture lint accepts legitimate host imports and ignores source-like strings", async () => {
  const result = await checkFixture({
    "core/src/runtime-discovery.ts":
      "import { readFileSync } from 'node:fs';\n",
    "core/src/example.ts": "const example = \"from 'electron'\";\n",
    "electron/src/main/native.ts":
      "import { readFile } from 'node:fs/promises';\n",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("architecture lint rejects imports across owned process boundaries", async () => {
  const result = await checkFixture({
    "core/src/ui.ts": "import type { Ref } from 'vue';\n",
    "core/src/read.ts": "import fs from 'node:fs';\n",
    "core/src/nested/runtime-discovery.ts": "import fs from 'node:fs';\n",
    "backend/src/host.ts": "await import('electron');\n",
    "backend/src/types.ts": "type App = import('electron').App;\n",
    "electron/src/main/driver.ts":
      "import { driver } from '@workspace/backend';\n",
    "electron/src/main/relative.ts":
      "import { driver } from '../../../backend/src/server';\n",
    "electron/src/preload/files.ts": "const fs = require('node:fs');\n",
  });
  assert.equal(result.status, 1, result.stderr);
  for (const [file, reason] of [
    ["core/src/ui.ts", "core cannot depend on desktop or UI packages"],
    ["core/src/read.ts", "core cannot use Node filesystem APIs"],
    [
      "core/src/nested/runtime-discovery.ts",
      "core cannot use Node filesystem APIs",
    ],
    ["backend/src/host.ts", "backend cannot depend on Electron"],
    ["backend/src/types.ts", "backend cannot depend on Electron"],
    [
      "electron/src/main/driver.ts",
      "Electron main must use the daemon protocol",
    ],
    [
      "electron/src/main/relative.ts",
      "Electron main must use the daemon protocol",
    ],
    ["electron/src/preload/files.ts", "preload cannot use raw filesystem"],
  ]) {
    assert.ok(result.stderr.includes(file), `${file}: ${result.stderr}`);
    assert.ok(result.stderr.includes(reason), `${file}: ${result.stderr}`);
  }
});

test("mobile code only receives app-owned contracts and browser-safe UI", async () => {
  const accepted = await checkFixture({
    "mobile/src/host.ts":
      "import { App } from '@capacitor/app';\nimport type { Agent } from '@workspace/core/contracts';\n",
    "mobile/src/conversation.ts":
      "import { createCodexConversationPaneController } from '@codex-app-sdk/vue';\n",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejected = await checkFixture({
    "mobile/src/desktop.ts": "import type { BrowserWindow } from 'electron';\n",
    "mobile/src/files.ts": "import fs from 'node:fs';\n",
    "mobile/src/driver.ts": "import { driver } from '@workspace/backend';\n",
    "mobile/src/relative.ts":
      "import { driver } from '../../backend/src/server';\n",
    "mobile/src/web.ts":
      "import { createAppBrowserClient } from '@workspace/web';\n",
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  for (const file of ["desktop", "files", "driver", "relative", "web"]) {
    assert.ok(
      rejected.stderr.includes(`mobile/src/${file}.ts`),
      rejected.stderr,
    );
  }
});
