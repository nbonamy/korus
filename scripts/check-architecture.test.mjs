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
  "client/backend/src",
  "client/electron/src/main",
  "client/electron/src/preload",
  "mobile/src",
  "client/vue/src",
  "server/frontend/src",
  "server/backend/src",
];

test("collector stays independently runnable without importing the desktop or companion relay", async () => {
  const good = await checkFixture({
    "server/backend/src/app.ts":
      "import { createCollectorServer } from './collector/server';",
    "server/backend/src/collector/server.ts":
      "import { createServer } from 'node:http'; import type { DailyTelemetryPayload } from '@workspace/core/telemetry'; import { TelemetryStore } from './store';",
    "server/backend/src/collector/store.ts": "import pg from 'pg';",
    "server/backend/src/collector/metrics.ts":
      "import {dayOf} from '@workspace/core/usage-time'; import type { TelemetryMetrics } from '@workspace/core/telemetry-metrics'; import { isUtcDay } from '@workspace/core/usage'; import { telemetryModels } from '@workspace/core/telemetry-models';",
  });
  assert.equal(good.status, 0, good.stderr);
  const bad = await checkFixture({
    "client/backend/src/runtime.ts":
      "import { createCollectorServer } from '../../../server/backend/src/collector/server';",
    "client/backend/src/companion/relay-main.ts": "import '../../../../server/backend/src/collector/main';",
    "server/backend/src/collector/server.ts":
      "import { BackendServer } from '../../../../client/backend/src/server';",
    "server/backend/src/collector/driver.ts":
      "import type { AgentBackendDriver } from '../../../../client/backend/src/drivers/types';",
    "server/backend/src/collector/private-settings.ts":
      "import type { Settings } from '@workspace/core/types';",
    "server/backend/src/collector/alias.ts":
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
    "client/electron/src/main/native.ts":
      "import { readFile } from 'node:fs/promises';\n",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("architecture lint rejects imports across owned process boundaries", async () => {
  const result = await checkFixture({
    "core/src/ui.ts": "import type { Ref } from 'vue';\n",
    "core/src/read.ts": "import fs from 'node:fs';\n",
    "core/src/nested/runtime-discovery.ts": "import fs from 'node:fs';\n",
    "client/backend/src/host.ts": "await import('electron');\n",
    "client/backend/src/types.ts": "type App = import('electron').App;\n",
    "client/electron/src/main/driver.ts":
      "import { driver } from '@workspace/backend';\n",
    "client/electron/src/main/relative.ts":
      "import { driver } from '../../../backend/src/server';\n",
    "client/electron/src/preload/files.ts": "const fs = require('node:fs');\n",
  });
  assert.equal(result.status, 1, result.stderr);
  for (const [file, reason] of [
    ["core/src/ui.ts", "core cannot depend on desktop or UI packages"],
    ["core/src/read.ts", "core cannot use Node filesystem APIs"],
    [
      "core/src/nested/runtime-discovery.ts",
      "core cannot use Node filesystem APIs",
    ],
    ["client/backend/src/host.ts", "backend cannot depend on Electron"],
    ["client/backend/src/types.ts", "backend cannot depend on Electron"],
    [
      "client/electron/src/main/driver.ts",
      "Electron main must use the daemon protocol",
    ],
    [
      "client/electron/src/main/relative.ts",
      "Electron main must use the daemon protocol",
    ],
    ["client/electron/src/preload/files.ts", "preload cannot use raw filesystem"],
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
      "import { driver } from '../../client/backend/src/server';\n",
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
    "client/backend/src/usage/usage-ledger.ts":
      "import { DatabaseSync } from 'node:sqlite';\nimport { serializeDailyTelemetry } from '@workspace/core/telemetry';\nimport { dayStart } from '@workspace/core/usage-time';\n",
    "client/backend/src/usage/usage-service.ts":
      "import { repositoryIdentityOf, resolveRepositoryRoots } from './repository-identity';\n",
    "client/backend/src/telemetry/consent-service.ts":
      "import { randomUUID } from 'node:crypto';\nimport type { TelemetryDeliveryPort } from '@workspace/core/telemetry-consent';\n",
    "core/src/telemetry.ts": "const example = 'fetch()';\n",
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejected = await checkFixture({
    "client/backend/src/usage/usage-ledger.ts":
      "import http from 'node:http';\nfetch('https://collector.invalid');\nsetTimeout(() => {}, 1);\n",
    "client/backend/src/telemetry/consent-service.ts":
      "import http from 'node:http';\nsetInterval(() => fetch('https://collector.invalid'), 1000);\n",
    "core/src/telemetry.ts": "globalThis.fetch('https://collector.invalid');\n",
    "client/backend/src/usage/telemetry-timer.ts":
      "globalThis.setTimeout(() => {}, 1);\n",
    "client/backend/src/usage/telemetry-preview.ts":
      "import { sender } from '../telemetry/telemetry-upload-service';\n",
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  for (const file of [
    "client/backend/src/usage/usage-ledger.ts",
    "client/backend/src/telemetry/consent-service.ts",
    "core/src/telemetry.ts",
    "client/backend/src/usage/telemetry-timer.ts",
    "client/backend/src/usage/telemetry-preview.ts",
  ])
    assert.ok(rejected.stderr.includes(file), rejected.stderr);
});

test("telemetry uploader ownership permits runtime composition and rejects alternate senders", async () => {
  const accepted = await checkFixture({
    "client/backend/src/runtime.ts":
      "import { TelemetryUploadService } from './telemetry/upload-service';\nconst endpoint = process.env.APP_TELEMETRY_ENDPOINT;\n",
    "client/electron/src/main/runtime-config.ts":
      "const endpoint = env.APP_TELEMETRY_ENDPOINT; const config = { APP_TELEMETRY_ENDPOINT: endpoint };\n",
    "client/backend/src/telemetry/upload-service.ts":
      "import type { UsageService } from '../usage/usage-service';\nfetch(endpoint); setTimeout(wake, 1000);\n",
    "client/electron/src/main/native.ts": "fetch(updateOrigin);\n",
    "client/vue/src/components/TelemetryConsentPanel.vue":
      '<script setup lang="ts">const example = "fetch()";</script>',
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  const rejected = await checkFixture({
    "client/backend/src/telemetry/alternate.ts":
      "import http from 'node:http';\nfetch(endpoint); setTimeout(send, 1000);\n",
    "client/backend/src/claude/driver.ts":
      "import { TelemetryUploadService } from '../telemetry/upload-service';\n",
    "client/backend/src/codex/driver.ts":
      "import type { DailyTelemetryPayload } from '@workspace/core/telemetry';\n",
    "client/backend/src/telemetry/duplicate.ts":
      "import { TelemetryUploadService } from './upload-service'; TelemetryUploadService.open({});\n",
    "client/electron/src/main/app-controller.ts":
      "class Controller { handleTelemetryActivity = () => fetch(endpoint); }\n",
    "client/backend/src/server.ts":
      "if (message.method === backendMethods.telemetryActivity) { fetch(endpoint); }\n",
    "client/backend/src/telemetry/upload-service.ts":
      "import { transport } from '../codex/transport';\n",
    "client/electron/src/main/native.ts":
      "const endpoint = process.env.APP_TELEMETRY_ENDPOINT;\n",
    "client/electron/src/main/runtime-config.ts":
      "fetch(env.APP_TELEMETRY_ENDPOINT);\n",
    "client/vue/src/components/TelemetryConsentPanel.vue":
      '<script setup lang="ts">fetch(endpoint); setTimeout(send, 1000);</script>',
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  for (const file of [
    "client/backend/src/telemetry/alternate.ts",
    "client/backend/src/claude/driver.ts",
    "client/backend/src/codex/driver.ts",
    "client/backend/src/telemetry/duplicate.ts",
    "client/electron/src/main/app-controller.ts",
    "client/backend/src/server.ts",
    "client/backend/src/telemetry/upload-service.ts",
    "client/electron/src/main/native.ts",
    "client/electron/src/main/runtime-config.ts",
    "client/vue/src/components/TelemetryConsentPanel.vue",
  ])
    assert.ok(rejected.stderr.includes(file), rejected.stderr);
});

test("private dashboard imports only browser-safe aggregate contracts", async () => {
  const good = await checkFixture({
    "server/frontend/src/view.ts":
      "import {dayOf} from '@workspace/core/usage-time'; import {computed} from 'vue'; import {ElSelect} from 'element-plus'; import 'element-plus/es/components/select/style/css'; import type {TelemetryMetrics} from '@workspace/core/telemetry-metrics'; import {telemetryModels} from '@workspace/core/telemetry-models'; import './format';",
  });
  assert.equal(good.status, 0, good.stderr);
  const bad = await checkFixture({
    "server/frontend/src/database.ts":
      "import fs from 'node:fs'; import pg from 'pg';",
    "server/frontend/src/backend.ts":
      "import {createMetricsServer} from '../../backend/src/collector/metrics-server';",
    "server/frontend/src/identity.ts":
      "import type {Settings} from '@workspace/core/contracts';",
    "server/frontend/src/desktop.ts":
      "import {state} from '@workspace/vue/app-state';",
  });
  assert.equal(bad.status, 1);
  for (const name of ["database.ts", "backend.ts", "identity.ts", "desktop.ts"])
    assert.ok(bad.stderr.includes(name), bad.stderr);
});
