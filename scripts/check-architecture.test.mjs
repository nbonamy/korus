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
  "vue/src",
];

test("collector stays independently runnable without importing the desktop or companion relay", async () => {
  const good = await checkFixture({
    "backend/src/collector/server.ts":
      "import { createServer } from 'node:http'; import type { DailyTelemetryPayload } from '@workspace/core/telemetry'; import { TelemetryStore } from './store';",
    "backend/src/collector/store.ts": "import pg from 'pg';",
    "backend/src/collector/metrics.ts":
      "import type { TelemetryMetrics } from '@workspace/core/telemetry-metrics'; import { isUtcDay } from '@workspace/core/usage'; import { telemetryModels } from '@workspace/core/telemetry-models';",
  });
  assert.equal(good.status, 0, good.stderr);
  const bad = await checkFixture({
    "backend/src/runtime.ts":
      "import { createCollectorServer } from './collector/server';",
    "backend/src/companion/relay-main.ts": "import '../collector/main';",
    "backend/src/collector/server.ts":
      "import { BackendServer } from '../server';",
    "backend/src/collector/driver.ts":
      "import type { AgentBackendDriver } from '../drivers/types';",
    "backend/src/collector/private-settings.ts":
      "import type { Settings } from '@workspace/core/types';",
    "backend/src/collector/alias.ts":
      "import { makeRuntime } from '@workspace/backend/runtime';",
  });
  assert.equal(bad.status, 1);
  for (const file of [
    "runtime.ts",
    "companion/relay-main.ts",
    "collector/server.ts",
    "collector/driver.ts",
    "collector/alias.ts",
    "collector/private-settings.ts",
  ])
    assert.ok(bad.stderr.includes(file), bad.stderr);
});

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

test("telemetry projection and serialization cannot import delivery code or call network/timer globals", async () => {
  const accepted = await checkFixture({
    "backend/src/usage/usage-ledger.ts":
      "import { DatabaseSync } from 'node:sqlite';\nimport { serializeDailyTelemetry } from '@workspace/core/telemetry';\n",
    "backend/src/telemetry/consent-service.ts":
      "import { randomUUID } from 'node:crypto';\nimport type { TelemetryDeliveryPort } from '@workspace/core/telemetry-consent';\n",
    "core/src/telemetry.ts": "const example = 'fetch()';\n",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejected = await checkFixture({
    "backend/src/usage/usage-ledger.ts":
      "import http from 'node:http';\nfetch('https://collector.invalid');\nsetTimeout(() => {}, 1);\n",
    "backend/src/telemetry/consent-service.ts":
      "import http from 'node:http';\nsetInterval(() => fetch('https://collector.invalid'), 1000);\n",
    "core/src/telemetry.ts": "globalThis.fetch('https://collector.invalid');\n",
    "backend/src/usage/telemetry-timer.ts":
      "globalThis.setTimeout(() => {}, 1);\n",
    "backend/src/usage/telemetry-preview.ts":
      "import { sender } from '../telemetry/telemetry-upload-service';\n",
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  for (const file of [
    "backend/src/usage/usage-ledger.ts",
    "backend/src/telemetry/consent-service.ts",
    "core/src/telemetry.ts",
    "backend/src/usage/telemetry-timer.ts",
    "backend/src/usage/telemetry-preview.ts",
  ])
    assert.ok(rejected.stderr.includes(file), rejected.stderr);
});

test("telemetry uploader ownership permits runtime composition and rejects alternate senders", async () => {
  const accepted = await checkFixture({
    "backend/src/runtime.ts":
      "import { TelemetryUploadService } from './telemetry/upload-service';\nconst endpoint = process.env.APP_TELEMETRY_ENDPOINT;\n",
    "backend/src/telemetry/upload-service.ts":
      "import type { UsageService } from '../usage/usage-service';\nfetch(endpoint); setTimeout(wake, 1000);\n",
    "electron/src/main/native.ts": "fetch(updateOrigin);\n",
    "vue/src/components/TelemetryConsentPanel.vue":
      '<script setup lang="ts">const example = "fetch()";</script>',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejected = await checkFixture({
    "backend/src/telemetry/alternate.ts":
      "import http from 'node:http';\nfetch(endpoint); setTimeout(send, 1000);\n",
    "backend/src/claude/driver.ts":
      "import { TelemetryUploadService } from '../telemetry/upload-service';\n",
    "backend/src/codex/driver.ts":
      "import type { DailyTelemetryPayload } from '@workspace/core/telemetry';\n",
    "backend/src/telemetry/duplicate.ts":
      "import { TelemetryUploadService } from './upload-service'; TelemetryUploadService.open({});\n",
    "electron/src/main/app-controller.ts":
      "class Controller { handleTelemetryActivity = () => fetch(endpoint); }\n",
    "backend/src/server.ts":
      "if (message.method === backendMethods.telemetryActivity) { fetch(endpoint); }\n",
    "backend/src/telemetry/upload-service.ts":
      "import { transport } from '../codex/transport';\n",
    "electron/src/main/native.ts":
      "const endpoint = process.env.APP_TELEMETRY_ENDPOINT;\n",
    "vue/src/components/TelemetryConsentPanel.vue":
      '<script setup lang="ts">fetch(endpoint); setTimeout(send, 1000);</script>',
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  for (const file of [
    "backend/src/telemetry/alternate.ts",
    "backend/src/claude/driver.ts",
    "backend/src/codex/driver.ts",
    "backend/src/telemetry/duplicate.ts",
    "electron/src/main/app-controller.ts",
    "backend/src/server.ts",
    "backend/src/telemetry/upload-service.ts",
    "electron/src/main/native.ts",
    "vue/src/components/TelemetryConsentPanel.vue",
  ])
    assert.ok(rejected.stderr.includes(file), rejected.stderr);
});
