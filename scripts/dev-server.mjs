import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".app-dev", "console");
const port = Number(process.env.API_PORT ?? 47811);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid local API_PORT.");
await mkdir(state, { recursive: true, mode: 0o700 });
await chmod(state, 0o700);
const token = path.join(state, "operator-token");
try {
  await writeFile(token, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
await chmod(token, 0o600);
const npm = process.env.npm_execpath;
const build = spawn(
  npm ? process.execPath : "npm",
  npm ? [npm, "run", "build:server"] : ["run", "build:server"],
  { cwd: root, stdio: "inherit" },
);
await new Promise((resolve, reject) => {
  build.once("error", reject);
  build.once("exit", (code) =>
    code === 0 ? resolve() : reject(Error("Local console build failed.")),
  );
});
const child = spawn(
  process.execPath,
  [path.join(root, "server/dist/api.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      API_SYNTHETIC: "1",
      API_REVERSE_PROXY: "",
      API_TLS_KEY: "",
      API_TLS_CERT: "",
      API_TELEMETRY_DATABASE: path.join(state, "telemetry.sqlite"),
      API_OPERATOR_TOKEN_FILE: token,
    },
    stdio: "inherit",
  },
);
child.once("error", () => {
  console.error("Local console could not start.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
console.log(`Local console: http://127.0.0.1:${port}`);
console.log(
  "Copy the local password: cat .app-dev/console/operator-token | pbcopy",
);
console.log(
  "Demo data stays in .app-dev/console/telemetry.sqlite and never reaches the hosted API.",
);
