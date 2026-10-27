import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  rm,
  mkdir,
  readdir,
  chmod,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { request } from "node:http";
import { createHash } from "node:crypto";
const http = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = request(url, { ...options, timeout: 15000 }, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("HTTP deadline")));
    req.end(options.body);
  });

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const stack = path.join(root, "backend/telemetry-stack");
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const oldDay = "2020-01-01";
const id = "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f";

// Owning operations boundary: broken readiness, overprivileged ingestion,
// disposable storage, failed/expired backup, unsafe restore, proxy logging and
// accidentally baked operator inputs must fail through real Compose/HTTP/SQL.
test(
  "isolated telemetry Compose preserves history, expires backup copies and restores exact metrics",
  { timeout: 300000 },
  async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-stack-"));
    const project = `telemetry-test-${process.pid}`;
    const image = `telemetry-test:${process.pid}`;
    const canary = "SENTINEL_OPERATOR_SECRET_847295012345";
    const env = { ...process.env };
    const run = (cmd, args, extra = {}) =>
      exec(cmd, args, {
        cwd: root,
        env,
        timeout: 120000,
        maxBuffer: 4000000,
        ...extra,
      });
    const compose = (...args) =>
      run("docker", [
        "compose",
        "-p",
        project,
        "-f",
        path.join(stack, "compose.yaml"),
        ...args,
      ]);
    const sql = async (query, role = "telemetry_migrate") =>
      (
        await compose(
          "exec",
          "-T",
          "db",
          "psql",
          "-U",
          role,
          "-d",
          "telemetry",
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          query,
        )
      ).stdout.trim();
    let endpoint;
    try {
      for (const name of [
        "admin",
        "migrate",
        "ingest",
        "backup",
        "read",
        "console_auth",
        "edge_realip",
        "read_access",
      ]) {
        const file = path.join(dir, name);
        await writeFile(
          file,
          name === "edge_realip"
            ? ""
            : name === "console_auth"
              ? `viewer:{SHA}${createHash("sha1").update(canary).digest("base64")}\n`
              : canary,
          {
            mode: 0o444,
          },
        );
        env[`TELEMETRY_${name.toUpperCase()}_FILE`] = file;
      }
      await mkdir(path.join(dir, "backups"), { mode: 0o777 });
      await chmod(path.join(dir, "backups"), 0o777);
      await mkdir(path.join(dir, "console"));
      await writeFile(
        path.join(dir, "console/index.html"),
        "<p>private console</p>",
      );
      await writeFile(
        path.join(dir, "console/main.js"),
        "export const fixture = true;",
      );
      Object.assign(env, {
        TELEMETRY_IMAGE: image,
        TELEMETRY_BACKUP_DIRECTORY: path.join(dir, "backups"),
        TELEMETRY_CONSOLE_DIRECTORY: path.join(dir, "console"),
        TELEMETRY_API_HOST: "api.invalid",
        TELEMETRY_CONSOLE_HOST: "console.invalid",
        TELEMETRY_CONSOLE_ORIGIN: "https://console.invalid",
        TELEMETRY_BIND_ADDRESS: "127.0.0.1",
        TELEMETRY_PORT: "0",
        TELEMETRY_PROXY_SUBNET: "172.29.253.0/24",
        TELEMETRY_PROXY_IP: "172.29.253.2",
        TELEMETRY_COLLECTOR_IP: "172.29.253.3",
        TELEMETRY_METRICS_IP: "172.29.253.4",
      });
      await t.test(
        "renders external inputs without exposing database ports or secrets and builds an isolated image",
        async () => {
          const rendered = JSON.parse(
            (await compose("config", "--format", "json")).stdout,
          );
          assert.equal(rendered.services.db.ports, undefined);
          assert.equal(rendered.services.collector.ports, undefined);
          assert.equal(rendered.networks.database.internal, true);
          assert.equal(rendered.networks.frontend.internal, true);
          assert.equal(rendered.networks.database.external, undefined);
          assert.equal(JSON.stringify(rendered).includes(canary), false);
          for (const service of Object.values(rendered.services))
            assert.equal(service.logging.driver, "none");
          await run(process.execPath, [
            path.join(root, "scripts/package-telemetry.mjs"),
            image,
          ]);
          const inspection = (await run("docker", ["image", "inspect", image]))
            .stdout;
          const files = (
            await run("docker", [
              "run",
              "--rm",
              "--entrypoint",
              "sh",
              image,
              "-c",
              "env; cat /opt/telemetry/*",
            ])
          ).stdout;
          assert.equal(
            inspection.includes(canary) ||
              files.includes(canary) ||
              files.includes(dir) ||
              files.includes("api.invalid") ||
              files.includes("console.invalid"),
            false,
          );
          assert.deepEqual(
            JSON.parse(
              (
                await run("docker", [
                  "run",
                  "--rm",
                  "--entrypoint",
                  "node",
                  image,
                  "-e",
                  "console.log(JSON.stringify(require('fs').readdirSync('/opt/telemetry').sort()))",
                ])
              ).stdout,
            ),
            ["collector.mjs", "container.mjs"],
          );
        },
      );
      await t.test(
        "starts after migrations with private roles, accepts HTTP and survives database restart",
        async () => {
          await compose("up", "-d", "--wait", "--wait-timeout", "90");
          const port = (await compose("port", "proxy", "8080")).stdout
            .trim()
            .split(":")
            .at(-1);
          endpoint = `http://127.0.0.1:${port}/v1/telemetry/daily`;
          const body = {
            installId: id,
            day,
            appVersion: "1.2.3",
            os: "unknown",
            usage: [
              {
                provider: "codex",
                model: "unknown",
                turns: 2,
                inputTokens: 100,
                cachedInputTokens: 50,
                outputTokens: 25,
                estimatedCostUsd: null,
              },
            ],
          };
          const post = () =>
            http(endpoint, {
              method: "POST",
              headers: {
                host: "api.invalid",
                "content-type": "application/json",
                "user-agent": canary,
                "x-real-ip": canary,
              },
              body: JSON.stringify(body),
            });
          assert.equal((await post()).status, 204);
          assert.deepEqual(
            JSON.parse(
              await sql(
                "SELECT json_build_array(current_setting('log_statement'),current_setting('log_min_error_statement'),current_setting('log_min_messages'),current_setting('log_connections'),current_setting('log_disconnections'),current_setting('log_parameter_max_length_on_error'))",
                "postgres",
              ),
            ),
            ["none", "panic", "panic", "off", "off", "0"],
          );
          // Old history is seeded via the migration owner, not backfilled by ingestion.
          await sql(
            `INSERT INTO install_days VALUES ('${id}','${oldDay}','1.0.0','unknown',now()); INSERT INTO usage_daily VALUES ('${id}','${oldDay}','claude','unknown',1,200,100,30,0.25)`,
          );
          assert.equal(
            await sql(
              "SELECT bool_and(NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) FROM pg_roles WHERE rolname IN ('telemetry_migrate','telemetry_ingest','telemetry_backup','telemetry_read')",
            ),
            "t",
          );
          for (const query of [
            "CREATE TABLE forbidden(x int)",
            "DELETE FROM install_days",
            "UPDATE installs SET first_reported_day=current_date",
            "SELECT * FROM telemetry_migrations",
          ])
            await assert.rejects(sql(query, "telemetry_ingest"));
          await assert.rejects(
            sql("DELETE FROM usage_daily", "telemetry_backup"),
          );
          await assert.rejects(
            sql(
              "INSERT INTO installs VALUES (gen_random_uuid(),current_date)",
              "telemetry_read",
            ),
          );
          const databaseId = (await compose("ps", "-q", "db")).stdout.trim();
          const collectorId = (
            await compose("ps", "-q", "collector")
          ).stdout.trim();
          await run("docker", ["stop", databaseId]);
          const unavailableAt = Date.now();
          assert.equal((await post()).status, 503);
          assert.ok(Date.now() - unavailableAt < 10000);
          await run("docker", ["start", databaseId]);
          await compose("up", "-d", "--wait", "--wait-timeout", "90", "db");
          assert.equal((await post()).status, 204);
          assert.equal(
            (await compose("ps", "-q", "collector")).stdout.trim(),
            collectorId,
          );
          await compose("restart", "db");
          await compose("up", "-d", "--wait", "--wait-timeout", "90");
          assert.equal((await post()).status, 204);
          await compose("stop", "db");
          await compose("rm", "-f", "db");
          await compose("up", "-d", "--wait", "--wait-timeout", "90");
          assert.equal((await post()).status, 204);
          assert.equal(await sql("SELECT count(*) FROM install_days"), "2");
          assert.equal(await sql("SELECT count(*) FROM installs"), "1");
          assert.equal(
            await sql(
              "SELECT sum(input_tokens+output_tokens) FROM usage_daily",
            ),
            "355",
          );
          assert.equal(
            (
              await http(`http://127.0.0.1:${port}/`, {
                headers: { host: "console.invalid" },
              })
            ).status,
            401,
          );
          assert.equal(
            (
              await http(`http://127.0.0.1:${port}/`, {
                headers: {
                  host: "console.invalid",
                  authorization: `Basic ${Buffer.from(`viewer:${canary}`).toString("base64")}`,
                },
              })
            ).status,
            200,
          );
          const metricsPath = `/v1/telemetry/metrics?from=${day}&to=${day}`;
          for (const [headers, expected] of [
            [{ host: "console.invalid" }, 401],
            [
              {
                host: "console.invalid",
                authorization: `Basic ${Buffer.from(`viewer:${canary}`).toString("base64")}`,
              },
              200,
            ],
            [
              {
                host: "console.invalid",
                authorization: `Basic ${Buffer.from(`viewer:${canary}`).toString("base64")}`,
                origin: "https://other.invalid",
              },
              403,
            ],
            [{ host: "api.invalid" }, 404],
          ])
            assert.equal(
              (
                await http(`http://127.0.0.1:${port}${metricsPath}`, {
                  headers,
                })
              ).status,
              expected,
            );
          const script = await http(`http://127.0.0.1:${port}/main.js`, {
            headers: {
              host: "console.invalid",
              authorization: `Basic ${Buffer.from(`viewer:${canary}`).toString("base64")}`,
            },
          });
          assert.equal(script.status, 200);
          assert.equal(
            script.headers["content-type"],
            "application/javascript",
          );
          assert.equal(
            (
              await http(endpoint, {
                method: "POST",
                headers: {
                  host: "api.invalid",
                  "content-type": "application/json",
                },
                body: JSON.stringify({ ...body, prompt: canary }),
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await http(
                endpoint.replace("/v1/telemetry/daily", `/${canary}`),
                { headers: { host: "api.invalid" } },
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        "writes atomic custom backups, expires exactly seven days and preserves live old history",
        async () => {
          await compose("run", "--rm", "backup", "once");
          const names = (await readdir(path.join(dir, "backups"))).filter((n) =>
            n.endsWith(".dump"),
          );
          assert.ok(names.length >= 1);
          for (const name of names)
            assert.equal(
              (await stat(path.join(dir, "backups", name))).mode & 0o077,
              0,
            );
          const now = 2000000000;
          for (const seconds of [now - 604801, now - 604800, now - 604799])
            await writeFile(
              path.join(dir, "backups", `${seconds}.dump`),
              "boundary",
            );
          await writeFile(
            path.join(dir, "backups", `${now - 604800}.partial.orphan`),
            "incomplete",
          );
          await compose("run", "--rm", "backup", "rotate", String(now));
          const remaining = await readdir(path.join(dir, "backups"));
          assert.equal(
            remaining.includes(`${now - 604800}.partial.orphan`),
            false,
          );
          assert.equal(remaining.includes(`${now - 604801}.dump`), false);
          assert.equal(remaining.includes(`${now - 604800}.dump`), false);
          assert.equal(remaining.includes(`${now - 604799}.dump`), true);
          await rm(path.join(dir, "backups", `${now - 604799}.dump`));
          // A failed dump must neither publish a partial backup nor retain expired copies.
          await writeFile(path.join(dir, "backups", "1.dump"), "expired");
          await assert.rejects(
            compose(
              "run",
              "--rm",
              "-e",
              "PGHOST=unreachable.invalid",
              "backup",
              "once",
            ),
          );
          assert.equal(
            (await readdir(path.join(dir, "backups"))).includes("1.dump"),
            false,
          );
          assert.equal(
            (await readdir(path.join(dir, "backups"))).some((n) =>
              n.includes(".partial"),
            ),
            false,
          );
          assert.equal(
            await sql(
              `SELECT count(*) FROM install_days WHERE day='${oldDay}'`,
            ),
            "1",
          );
          // A newly created backup is deliberately used after clock-boundary fixtures.
          await compose("run", "--rm", "backup", "once");
        },
      );
      await t.test(
        "restores a backup into a separate disposable database without changing primary records",
        async () => {
          const archive = (await readdir(path.join(dir, "backups")))
            .filter((n) => n.endsWith(".dump"))
            .sort()
            .at(-1);
          await compose(
            "exec",
            "-T",
            "db",
            "createdb",
            "-U",
            "postgres",
            "-O",
            "telemetry_migrate",
            "telemetry_restore",
          );
          const bytes = await readFile(path.join(dir, "backups", archive));
          await writeFile(
            path.join(dir, "backups", "broken.dump"),
            bytes.subarray(0, Math.floor(bytes.length * 0.8)),
            { mode: 0o644 },
          );
          await assert.rejects(
            compose(
              "run",
              "--rm",
              "-e",
              "PGDATABASE=telemetry_restore",
              "restore",
              "broken.dump",
            ),
          );
          assert.equal(
            (
              await compose(
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "telemetry_migrate",
                "-d",
                "telemetry_restore",
                "-At",
                "-c",
                "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
              )
            ).stdout.trim(),
            "0",
          );
          await rm(path.join(dir, "backups", "broken.dump"));
          await assert.rejects(compose("run", "--rm", "restore", archive));
          await compose(
            "run",
            "--rm",
            "-e",
            "PGDATABASE=telemetry_restore",
            "restore",
            archive,
          );
          const restored = (
            await compose(
              "exec",
              "-T",
              "db",
              "psql",
              "-U",
              "telemetry_migrate",
              "-d",
              "telemetry_restore",
              "-At",
              "-c",
              "SELECT json_build_array((SELECT count(*) FROM installs),(SELECT count(*) FROM install_days),(SELECT sum(input_tokens+output_tokens) FROM usage_daily),(SELECT count(*) FROM install_days WHERE day='2020-01-01'))",
            )
          ).stdout.trim();
          assert.deepEqual(JSON.parse(restored), [1, 2, 355, 1]);
          await assert.rejects(
            compose(
              "run",
              "--rm",
              "-e",
              "PGDATABASE=telemetry_restore",
              "restore",
              archive,
            ),
          );
          assert.equal(await sql("SELECT count(*) FROM install_days"), "2");
          const evidence = {
            postgres: "18.3",
            acknowledgedStatus: 204,
            installs: 1,
            activeDays: 2,
            tokens: 355,
            oldestDay: oldDay,
            restored: [1, 2, 355, 1],
            backupExpirySeconds: 604800,
            databasePublishedPorts: 0,
          };
          if (process.env.TELEMETRY_STACK_EVIDENCE)
            await writeFile(
              process.env.TELEMETRY_STACK_EVIDENCE,
              JSON.stringify(evidence, null, 2) + "\n",
            );
        },
      );
      await t.test(
        "persists no request canaries in container logs",
        async () => {
          const logged = (await compose("logs", "--no-color")).stdout;
          assert.equal(
            logged.includes(canary) ||
              logged.includes(id) ||
              logged.includes("api.invalid"),
            false,
          );
          assert.equal(logged.trim(), "");
        },
      );
    } finally {
      await compose("down", "--volumes", "--remove-orphans").catch(() => {});
      await run("docker", ["image", "rm", image]).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  },
);
