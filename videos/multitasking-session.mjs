import { build } from "esbuild";
import { _electron } from "playwright";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// An owned app copy and fictional daemon: no release profile or provider credentials.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".app-dev/multitasking-film");
const sourceApp = "/Applications/Korus.app";
const demoApp = "/Applications/Korus Multitasking Demo.app";
if (process.platform !== "darwin")
  throw new Error("The recording session needs macOS.");
const running = execFileSync("ps", ["-axo", "command"], { encoding: "utf8" });
if (
  running
    .split("\n")
    .some((line) => line.startsWith(`${demoApp}/Contents/MacOS/`))
) {
  throw new Error("Close the existing Multitasking Demo before resetting it.");
}
if (!process.argv.includes("--refresh"))
  throw new Error("Pass --refresh to replace only the named demo app copy.");
await mkdir(output, { recursive: true });
const home = await mkdtemp(path.join(tmpdir(), "korus-multitasking-"));
const profile = path.join(home, "electron");
await rm(demoApp, { recursive: true, force: true });
execFileSync("cp", ["-cR", sourceApp, demoApp]);
const plist = `${demoApp}/Contents/Info.plist`;
const version = execFileSync(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", plist],
  { encoding: "utf8" },
).trim();
for (const [key, value] of Object.entries({
  CFBundleIdentifier: "dev.korus.multitasking-demo",
  CFBundleDisplayName: "Korus Multitasking Demo",
})) {
  execFileSync("plutil", ["-replace", key, "-string", value, plist]);
}
// Keep CFBundleName unchanged so Electron can locate the shipped helpers.
execFileSync("plutil", [
  "-replace",
  "CFBundleURLTypes",
  "-json",
  JSON.stringify([
    {
      CFBundleURLName: "Multitasking Demo",
      CFBundleURLSchemes: ["korus-dev-multitasking"],
    },
  ]),
  plist,
]);
await flipFuses(demoApp, {
  version: FuseVersion.V1,
  [FuseV1Options.EnableNodeCliInspectArguments]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
  [FuseV1Options.RunAsNode]: true,
});
execFileSync("codesign", ["--force", "--deep", "--sign", "-", demoApp]);
const daemonFile = path.join(output, "fixture-daemon.mjs");
await build({
  entryPoints: [path.join(root, "videos/fixtures/multitasking/daemon.ts")],
  outfile: daemonFile,
  bundle: true,
  platform: "node",
  target: "node26",
  format: "esm",
  packages: "external",
  loader: { ".md": "text" },
  alias: { "@workspace/core": path.join(root, "core/src") },
});
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("APP_") &&
      !key.startsWith("KORUS_") &&
      key !== "ELECTRON_RUN_AS_NODE",
  ),
);
const daemon = spawn(process.execPath, [daemonFile], {
  env: { ...cleanEnv, APP_HOME: home, APP_DEMO_VERSION: version },
  stdio: ["ignore", "inherit", "pipe"],
});
await new Promise((resolve, reject) => {
  daemon.once("exit", (code) =>
    reject(new Error(`Fixture daemon exited: ${code}`)),
  );
  daemon.stderr.on("data", (data) => {
    process.stderr.write(data);
    if (String(data).includes("Demo daemon ready")) resolve();
  });
});
await mkdir(profile, { recursive: true });
await writeFile(
  path.join(profile, "window-layout.json"),
  JSON.stringify({
    version: 1,
    windows: [
      {
        viewState: null,
        frame: {
          bounds: { x: 64, y: 33, width: 1600, height: 900 },
          isMaximized: false,
        },
      },
    ],
  }),
);
const desktop = await _electron.launch({
  executablePath: `${demoApp}/Contents/MacOS/Korus`,
  args: [`--user-data-dir=${profile}`],
  env: {
    ...cleanEnv,
    APP_HOME: home,
    APP_BACKEND_MODE: "existing",
    APP_BACKEND_SOCKET: path.join(home, "daemon.sock"),
    APP_BACKEND_COMMAND: `${sourceApp}/Contents/Resources/runtime/node`,
    APP_BACKEND_ARGS: `${sourceApp}/Contents/Resources/daemon/daemon.mjs,connect`,
    APP_BACKEND_WATCH_FILE: "",
    APP_DEV_PROTOCOL_SCHEME: "korus-dev-multitasking",
  },
  timeout: 60000,
});
const window = await desktop.firstWindow();
await window.locator(".app-shell").waitFor();
const controls = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/bounds") {
      const id = Number(url.searchParams.get("id"));
      const bounds = JSON.parse(url.searchParams.get("value"));
      await desktop.evaluate(
        ({ BrowserWindow }, data) => {
          const target = BrowserWindow.fromId(data.id);
          target.setBounds(data.bounds);
        },
        { id, bounds },
      );
    } else if (url.pathname !== "/windows") {
      res.writeHead(404).end();
      return;
    }
    const windows = await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        id: w.id,
        title: w.getTitle(),
        bounds: w.getBounds(),
      })),
    );
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(windows));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((resolve) => controls.listen(0, "127.0.0.1", resolve));
const environment = {
  home,
  profile,
  sourceApp,
  app: demoApp,
  version,
  daemonPid: daemon.pid,
  desktopPid: desktop.process().pid,
  controlPort: controls.address().port,
};
await writeFile(
  path.join(output, "environment.json"),
  JSON.stringify(environment, null, 2),
);
console.log("Demo ready:", environment);
const close = async () => {
  controls.close();
  await desktop.close();
  daemon.kill("SIGTERM");
};
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
