import { build } from "esbuild";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  process.argv[2] || path.join(root, ".app-dev/shared-chat-probe-results.json"),
);
let result = {
  status: "failed",
  stage: "startup",
  error: "Could not prepare the shared-chat probe.",
};
let directory;
try {
  const invitation = process.env.TEST_SHARED_LINK?.trim();
  const origin = process.env.APP_COMPANION_RELAY_URL?.trim();
  const peerId = process.env.APP_COMPANION_RELAY_PEER_ID?.trim();
  if (!invitation)
    result = {
      status: "failed",
      stage: "configuration",
      error: "Set the TEST_SHARED_LINK secret before running this probe.",
    };
  else if (Boolean(origin) !== Boolean(peerId))
    result = {
      status: "failed",
      stage: "configuration",
      error:
        "Set both relay URL and peer identity when overriding the product relay.",
    };
  else {
    // Resolve external packages from the backend workspace, including nested SDK installs.
    const workspace = path.join(root, "backend/.app-dev");
    await mkdir(workspace, { recursive: true });
    directory = await mkdtemp(path.join(workspace, "shared-chat-probe-"));
    const bundle = path.join(directory, "probe.mjs");
    await build({
      absWorkingDir: root,
      entryPoints: ["backend/src/sharing/guest-probe.ts"],
      outfile: bundle,
      platform: "node",
      target: "node26",
      format: "esm",
      bundle: true,
      packages: "external",
      alias: { "@workspace/core": path.join(root, "core/src") },
      logLevel: "silent",
    });
    const { probeSharedChat } = await import(pathToFileURL(bundle).href);
    result = await probeSharedChat(
      invitation,
      origin && peerId ? { origin, peerId } : undefined,
    );
  }
} catch {
  // Do not print exceptions: dependency/transport diagnostics can contain bearer material.
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}

try {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [
      ["Status", result.status],
      ["Stage", result.stage],
      ["UTC sent", result.sentAtUtc],
      ["UTC acknowledged", result.acknowledgedAtUtc],
      ["Connect (ms)", result.connectMs],
      ["Join (ms)", result.joinMs],
      ["Send to acknowledgment (ms)", result.sendToAckMs],
      ["Error", result.error],
    ].filter(([, value]) => value !== undefined);
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Shared-chat relay probe\n\n| Measurement | Value |\n| --- | --- |\n${rows.map(([name, value]) => `| ${name} | ${value} |`).join("\n")}\n\nSend-to-ack uses a monotonic clock and includes owner processing. It does not measure desktop rendering time.\n`,
    );
  }
  if (result.status !== "acknowledged") process.exitCode = 1;
} catch {
  console.error("Could not write the shared-chat probe results.");
  process.exitCode = 1;
}
