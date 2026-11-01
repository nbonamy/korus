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
import { request, createServer } from "node:http";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { dashboardWorkflow } from "./dashboard.browser.mjs";
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
const root = fileURLToPath(new URL("../../", import.meta.url));
const stack = path.join(root, "server/deploy");
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
    const authCanaries = [];
    let desktopProfile;
    try {
      for (const name of [
        "admin",
        "migrate",
        "ingest",
        "backup",
        "read",
        "edge_realip",
        "read_access",
      ]) {
        const file = path.join(dir, name);
        await writeFile(file, name === "edge_realip" ? "" : canary, {
          mode: 0o444,
        });
        env[`TELEMETRY_${name.toUpperCase()}_FILE`] = file;
      }
      await mkdir(path.join(dir, "backups"), { mode: 0o777 });
      await chmod(path.join(dir, "backups"), 0o777);
      await mkdir(path.join(dir, "console"));
      await run(
        process.execPath,
        [
          path.join(root, "node_modules/vite/bin/vite.js"),
          "build",
          "--config",
          "server/frontend/vite.config.ts",
          "--outDir",
          path.join(dir, "console"),
        ],
        {
          env: {
            ...env,
            VITE_OPERATOR_SECRET: canary,
            TELEMETRY_DATABASE_URL: canary,
            TELEMETRY_READ_ACCESS: canary,
          },
        },
      );
      const builtFiles = await readdir(path.join(dir, "console/assets"));
      for (const file of builtFiles) {
        const contents = await readFile(
          path.join(dir, "console/assets", file),
          "utf8",
        );
        assert.equal(
          contents.includes(canary) ||
            contents.includes(dir) ||
            contents.includes("api.invalid") ||
            contents.includes("console.invalid"),
          false,
        );
      }
      const probe = createServer();
      await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const consolePort = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      Object.assign(env, {
        BACKEND_ADMIN_PASSWORD: canary,
        TELEMETRY_CONSOLE_ALLOW_LOOPBACK_HTTP: "1",
        TELEMETRY_IMAGE: image,
        TELEMETRY_BACKUP_DIRECTORY: path.join(dir, "backups"),
        TELEMETRY_CONSOLE_DIRECTORY: path.join(dir, "console"),
        TELEMETRY_API_HOST: "api.invalid",
        TELEMETRY_CONSOLE_HOST: "127.0.0.1",
        TELEMETRY_CONSOLE_ORIGIN: `http://127.0.0.1:${consolePort}`,
        TELEMETRY_BIND_ADDRESS: "127.0.0.1",
        TELEMETRY_PORT: String(consolePort),
        TELEMETRY_PROXY_SUBNET: "172.29.253.0/24",
        TELEMETRY_PROXY_IP: "172.29.253.2",
        TELEMETRY_COLLECTOR_IP: "172.29.253.3",
        TELEMETRY_METRICS_IP: "172.29.253.4",
        TELEMETRY_AUTH_IP: "172.29.253.5",
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
          assert.equal(
            rendered.services.auth.environment.BACKEND_ADMIN_PASSWORD,
            canary,
          );
          assert.equal(rendered.services.auth.ports, undefined);
          assert.deepEqual(Object.keys(rendered.services.auth.networks), [
            "frontend",
          ]);
          // The operator explicitly supplies a runtime-only password environment;
          // it must be present only on auth, never in any other runtime inputs.
          delete rendered.services.auth.environment.BACKEND_ADMIN_PASSWORD;
          assert.equal(JSON.stringify(rendered).includes(canary), false);
          for (const [name, service] of Object.entries(rendered.services)) {
            if (["collector", "metrics", "auth", "migrate"].includes(name)) {
              assert.deepEqual(service.logging, {
                driver: "local",
                options: {
                  "max-size": "5m",
                  "max-file": "3",
                  mode: "non-blocking",
                  "max-buffer-size": "1m",
                },
              });
            } else assert.equal(service.logging.driver, "none");
          }
          await run(process.execPath, [
            path.join(root, "server/scripts/package.mjs"),
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
            `INSERT INTO install_days(install_id,day,app_version,os,received_at) VALUES ('${id}','${oldDay}','1.0.0','unknown',now()); INSERT INTO usage_daily(install_id,day,provider,model,turns,input_tokens,cached_input_tokens,output_tokens,estimated_cost_usd) VALUES ('${id}','${oldDay}','claude','unknown',1,200,100,30,0.25)`,
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
              "INSERT INTO installs(install_id,first_reported_day) VALUES (gen_random_uuid(),current_date)",
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
          const consoleOrigin = `http://127.0.0.1:${port}`;
          const anonymous = await http(`${consoleOrigin}/`);
          assert.equal(anonymous.status, 302);
          assert.equal(anonymous.headers.location, "/login");
          assert.equal(anonymous.headers["www-authenticate"], undefined);
          assert.equal((await http(`${consoleOrigin}/index.html`)).status, 302);
          assert.equal((await http(`${consoleOrigin}/login`)).status, 200);
          const session = `${consoleOrigin}/auth/session`;
          assert.equal((await http(session)).status, 401);
          const login = (username = "admin", origin = consoleOrigin) =>
            http(session, {
              method: "POST",
              headers: { origin, "content-type": "application/json" },
              body: JSON.stringify({ username, password: canary }),
            });
          assert.equal(
            (await login("admin", "https://other.invalid")).status,
            403,
          );
          authCanaries.push("SESSION_LOGIN_USER_CANARY");
          assert.equal((await login(authCanaries[0])).status, 401);
          const signedIn = await login();
          assert.equal(signedIn.status, 204);
          let cookie = signedIn.headers["set-cookie"][0].split(";")[0];
          authCanaries.push(cookie);
          assert.equal(
            (await http(session, { headers: { cookie } })).status,
            204,
          );
          assert.equal(
            (await http(`${consoleOrigin}/`, { headers: { cookie } })).status,
            200,
          );
          const metricsPath = `/v1/telemetry/metrics?from=${day}&to=${day}`;
          for (const [headers, expected] of [
            [{}, 401],
            [{ cookie }, 200],
            [{ cookie, origin: "https://other.invalid" }, 403],
            [{ host: "api.invalid" }, 404],
          ]) {
            const response = await http(`${consoleOrigin}${metricsPath}`, {
              headers,
            });
            assert.equal(response.status, expected);
            assert.equal(response.headers["www-authenticate"], undefined);
          }
          assert.equal(
            (
              await http(session, {
                method: "DELETE",
                headers: { cookie, origin: "https://other.invalid" },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await http(session, {
                method: "DELETE",
                headers: { cookie, origin: consoleOrigin },
              })
            ).status,
            204,
          );
          assert.equal(
            (
              await http(`${consoleOrigin}${metricsPath}`, {
                headers: { cookie },
              })
            ).status,
            401,
          );
          const nextLogin = await login();
          cookie = nextLogin.headers["set-cookie"][0].split(";")[0];
          authCanaries.push(cookie);
          const script = await http(
            `http://127.0.0.1:${port}/assets/${builtFiles.find((f) => f.endsWith(".js"))}`,
            {
              headers: {
                cookie,
              },
            },
          );
          assert.equal(script.status, 200);
          assert.equal(
            (
              await http(
                `http://127.0.0.1:${port}/assets/${builtFiles.find((f) => f.endsWith(".js"))}`,
              )
            ).status,
            200,
          );
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
          // Archives belong to the backup container's UID, not the Linux host
          // runner. Keep them private while creating the corrupt-restore fixture.
          await compose(
            "run", "--rm", "--entrypoint", "sh", "backup", "-eu", "-c",
            'umask 077; size=$(wc -c < "$1"); head -c "$((size * 4 / 5))" "$1" > /backups/broken.dump',
            "sh", `/backups/${archive}`,
          );
          assert.equal(
            (await stat(path.join(dir, "backups", "broken.dump"))).mode & 0o077,
            0,
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
        "connects a private desktop profile through lost acknowledgements and restarts to the real collector",
        async () => {
          await sql("TRUNCATE usage_daily,install_days,installs");
          await mkdir(path.join(root, "client/backend/node_modules"), {
            recursive: true,
          });
          const bundleDir = await mkdtemp(
            path.join(root, "client/backend/node_modules/.telemetry-profile-"),
          );
          try {
            const outfile = path.join(bundleDir, "workflow.mjs");
            await build({
              entryPoints: [
                path.join(
                  root,
                  "client/backend/src/telemetry/__tests__/desktop-stack-workflow.ts",
                ),
              ],
              outfile,
              bundle: true,
              platform: "node",
              format: "esm",
              packages: "external",
              loader: { ".md": "text" },
              alias: { "@workspace/core": path.join(root, "core/src") },
            });
            const { desktopStackWorkflow } = await import(
              pathToFileURL(outfile).href
            );
            desktopProfile = await desktopStackWorkflow(endpoint);
            assert.equal(await sql("SELECT count(*) FROM installs"), "1");
            assert.equal(await sql("SELECT count(*) FROM install_days"), "2");
            assert.equal(
              await sql(
                "SELECT sum(input_tokens+output_tokens) FROM usage_daily",
              ),
              "120",
            );
            if (process.env.TELEMETRY_PROFILE_EVIDENCE)
              await writeFile(
                process.env.TELEMETRY_PROFILE_EVIDENCE,
                JSON.stringify(desktopProfile, null, 2) + "\n",
              );
          } finally {
            await rm(bundleDir, { recursive: true, force: true });
          }
        },
      );
      await t.test(
        "renders the private dashboard from the desktop profile and seeded Postgres on desktop and mobile",
        async () => {
          assert.ok(
            desktopProfile,
            "the desktop-to-collector workflow must succeed first",
          );
          const port = new URL(endpoint).port;
          const seed = await readFile(
            path.join(
              root,
              "server/backend/src/collector/__tests__/fixtures/metrics-seed.sql",
            ),
            "utf8",
          );
          await dashboardWorkflow({
            port,
            password: canary,
            seed,
            sql,
            desktopProfile,
            replaceProfile: async () => {
              const body = JSON.parse(desktopProfile.attempts[0].body);
              body.usage = [
                {
                  provider: "claude",
                  model: "unknown",
                  turns: 2,
                  inputTokens: 60,
                  cachedInputTokens: 10,
                  outputTokens: 10,
                  estimatedCostUsd: null,
                },
              ];
              assert.equal(
                (
                  await http(endpoint, {
                    method: "POST",
                    headers: {
                      host: "api.invalid",
                      "content-type": "application/json",
                    },
                    body: JSON.stringify(body),
                  })
                ).status,
                204,
              );
              assert.equal(await sql("SELECT count(*) FROM installs"), "1");
              assert.equal(await sql("SELECT count(*) FROM install_days"), "2");
              assert.equal(await sql("SELECT count(*) FROM usage_daily"), "1");
              assert.equal(
                await sql("SELECT provider FROM usage_daily"),
                "claude",
              );
              assert.equal(
                await sql(
                  "SELECT sum(input_tokens+output_tokens) FROM usage_daily",
                ),
                "70",
              );
            },
          });
        },
      );
      await t.test(
        "persists no request canaries in container logs",
        async () => {
          await sql(
            "CREATE FUNCTION logging_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '" +
              canary +
              "'; END $$; CREATE TRIGGER logging_failure BEFORE INSERT ON usage_daily FOR EACH ROW EXECUTE FUNCTION logging_failure()",
          );
          try {
            assert.equal(
              (
                await http(endpoint, {
                  method: "POST",
                  headers: {
                    host: "api.invalid",
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    installId: id,
                    day,
                    appVersion: "1.2.3",
                    os: "unknown",
                    usage: [
                      {
                        provider: "codex",
                        model: "unknown",
                        turns: 1,
                        inputTokens: null,
                        cachedInputTokens: null,
                        outputTokens: null,
                        estimatedCostUsd: null,
                      },
                    ],
                  }),
                })
              ).status,
              503,
            );
          } finally {
            await sql("DROP FUNCTION logging_failure() CASCADE");
          }
          const logged = (await compose("logs", "--no-color")).stdout;
          assert.equal(
            logged.includes(canary) ||
              logged.includes(id) ||
              logged.includes("api.invalid") ||
              authCanaries.some((value) => logged.includes(value)),
            false,
          );
          assert.match(logged, /"event":"ready"/);
          const records = (
            await compose(
              "logs",
              "--no-color",
              "--no-log-prefix",
              "collector",
              "metrics",
              "auth",
              "migrate",
            )
          ).stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          assert.ok(
            records.some((entry) => entry.event === "operation_failed"),
          );
          if (process.env.TELEMETRY_LOGGING_EVIDENCE)
            await writeFile(
              process.env.TELEMETRY_LOGGING_EVIDENCE,
              JSON.stringify(records, null, 2) + "\n",
            );
          for (const record of records) {
            assert.ok(
              Object.keys(record).every((key) =>
                [
                  "timestamp",
                  "level",
                  "service",
                  "event",
                  "operation",
                  "reason",
                  "code",
                  "message",
                  "locations",
                ].includes(key),
              ),
            );
          }
        },
      );
    } finally {
      await compose("down", "--volumes", "--remove-orphans").catch(() => {});
      await run("docker", ["image", "rm", image]).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  },
);
