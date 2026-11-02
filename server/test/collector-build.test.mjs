import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("standalone collector bundles without operator secrets and emits a structured safe startup failure", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const temp = await mkdtemp(path.join(os.tmpdir(), "collector-build-"));
  try {
    await mkdir(path.join(temp, "server/backend"), { recursive: true });
    await copyFile(
      path.join(root, "server/backend/vite.config.ts"),
      path.join(temp, "server/backend/vite.config.ts"),
    );
    const link = process.platform === "win32" ? "junction" : "dir";
    await symlink(
      path.join(root, "server/backend/src"),
      path.join(temp, "server/backend/src"),
      link,
    );
    for (const name of ["core", "node_modules"])
      await symlink(path.join(root, name), path.join(temp, name), link);
    const canary = "OPERATOR_SECRET_CANARY_612963";
    await writeFile(
      path.join(temp, ".env"),
      `TELEMETRY_DATABASE_URL=${canary}\nAPP_TELEMETRY_ENDPOINT=${canary}\n`,
    );
    await writeFile(
      path.join(temp, "build.mjs"),
      `import { build } from 'vite'; await build({ configFile: ${JSON.stringify(path.join(temp, "server/backend/vite.config.ts"))}, logLevel: 'silent' });`,
    );
    const build = spawnSync(process.execPath, [path.join(temp, "build.mjs")], {
      cwd: temp,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(build.status, 0, build.stderr);
    const bundle = path.join(temp, "server/backend/dist/collector.mjs");
    assert.equal((await readFile(bundle, "utf8")).includes(canary), false);
    const run = spawnSync(process.execPath, [bundle, "serve", canary], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, TELEMETRY_DATABASE_URL: canary },
    });
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stderr, "");
    assert.deepEqual(JSON.parse(run.stdout), {
      timestamp: JSON.parse(run.stdout).timestamp,
      level: "error",
      service: "collector",
      event: "startup_failed",
      operation: "configuration",
      reason: "file_missing",
      code: "ENOENT",
      message: "Required operator file does not exist.",
    });
    assert.equal(
      Number.isNaN(Date.parse(JSON.parse(run.stdout).timestamp)),
      false,
    );
    // The executable must suppress Node's raw dump on an unexpected fatal error.
    const fault = path.join(temp, "fatal.mjs");
    await writeFile(
      fault,
      `process.on('beforeExit', () => { throw new Error(${JSON.stringify(canary)}); });`,
    );
    const fatal = spawnSync(
      process.execPath,
      ["--import", fault, bundle, "serve", canary],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, TELEMETRY_DATABASE_URL: canary },
      },
    );
    assert.equal(fatal.status, 1);
    assert.equal(fatal.stderr, "");
    const fatalEntry = fatal.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .at(-1);
    assert.equal(fatalEntry.event, "process_failed");
    assert.equal(fatalEntry.operation, "process");
    assert.equal(fatalEntry.reason, "unexpected_error");
    assert.equal(fatal.stdout.includes(canary), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
