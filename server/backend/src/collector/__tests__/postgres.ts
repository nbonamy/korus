import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";

const exec = promisify(execFile);

/** Always real disposable Postgres, never a fake or an opportunistically skipped test. */
export async function disposablePostgres() {
  const { stdout } = await exec(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--log-driver=none",
      "--tmpfs",
      "/var/lib/postgresql",
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=telemetry_test",
      "postgres:18.3-alpine",
      "-c",
      "log_statement=none",
      "-c",
      "log_min_error_statement=panic",
      "-c",
      "log_min_messages=panic",
      "-c",
      "log_connections=off",
      "-c",
      "log_disconnections=off",
    ],
    { timeout: 120_000 },
  );
  const id = stdout.trim();
  const stop = async () => {
    await exec("docker", ["rm", "-f", id]);
  };
  try {
    const { stdout: binding } = await exec("docker", ["port", id, "5432/tcp"]);
    const port = Number(binding.trim().split(":").at(-1));
    const url = `postgresql://postgres@127.0.0.1:${port}/telemetry_test`;
    for (let i = 0; i < 200; i++) {
      const client = new pg.Client({
        connectionString: url,
        connectionTimeoutMillis: 500,
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
        return { url, stop };
      } catch {
        await pause(50);
      } finally {
        await client.end();
      }
    }
    throw new Error("Disposable Postgres did not become ready.");
  } catch (error) {
    await stop();
    throw error;
  }
}
