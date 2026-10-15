import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("local console startup isolates credentials and storage from deployment settings", () => {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "korus-local-console-")),
  );
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, "server", "dist"), { recursive: true });
    copyFileSync(
      new URL("./dev-server.mjs", import.meta.url),
      path.join(root, "scripts", "dev-server.mjs"),
    );
    const npm = path.join(root, "npm.cjs"),
      trace = path.join(root, "trace.json");
    writeFileSync(
      npm,
      'process.exit(process.argv.includes("build:server")?0:1);',
    );
    writeFileSync(
      path.join(root, "server", "dist", "api.mjs"),
      `
   import {readFileSync,writeFileSync,statSync} from 'node:fs';
   const env=process.env;
   writeFileSync(env.CONSOLE_TRACE,JSON.stringify({host:env.API_HOST,synthetic:env.API_SYNTHETIC,proxy:env.API_REVERSE_PROXY,tls:env.API_TLS_KEY,database:env.API_TELEMETRY_DATABASE,tokenFile:env.API_OPERATOR_TOKEN_FILE,length:readFileSync(env.API_OPERATOR_TOKEN_FILE,'utf8').length,mode:statSync(env.API_OPERATOR_TOKEN_FILE).mode&0o777}));
  `,
    );
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/dev-server.mjs")],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          npm_execpath: npm,
          CONSOLE_TRACE: trace,
          API_PORT: "47811",
          API_HOST: "0.0.0.0",
          API_SYNTHETIC: "0",
          API_REVERSE_PROXY: "1",
          API_TLS_KEY: "/not-local",
          API_TELEMETRY_DATABASE: "/not-local",
          API_OPERATOR_TOKEN_FILE: "/not-local",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(trace, "utf8")), {
      host: "127.0.0.1",
      synthetic: "1",
      proxy: "",
      tls: "",
      database: path.join(root, ".app-dev", "console", "telemetry.sqlite"),
      tokenFile: path.join(root, ".app-dev", "console", "operator-token"),
      length: 64,
      mode: 0o600,
    });
    assert.ok(
      !result.stdout.includes(
        readFileSync(
          path.join(root, ".app-dev", "console", "operator-token"),
          "utf8",
        ),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
