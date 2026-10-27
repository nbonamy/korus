import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A temporary allowlisted build context excludes the repository, .env, operator
// files and node_modules. Docker never receives the checkout as build context.
const root = fileURLToPath(new URL("../", import.meta.url));
const tag = process.argv[2];
if (process.argv.length !== 3 || !tag || tag.startsWith("-"))
  throw new Error("Supply one local image tag.");
const exec = promisify(execFile);
const context = await mkdtemp(path.join(os.tmpdir(), "telemetry-image-"));
try {
  await exec(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "backend/vite.collector.config.ts",
    ],
    { cwd: root },
  );
  await copyFile(
    path.join(root, "backend/collector-dist/collector.mjs"),
    path.join(context, "collector.mjs"),
  );
  for (const name of ["Dockerfile", "container.mjs"])
    await copyFile(
      path.join(root, "backend/telemetry-stack", name),
      path.join(context, name),
    );
  await exec("docker", ["build", "--tag", tag, context], {
    maxBuffer: 4000000,
  });
  process.stdout.write("Collector image built from isolated context.\n");
} finally {
  await rm(context, { recursive: true, force: true });
}
