import { readFile, writeFile } from "node:fs/promises";
import { isIP, createConnection } from "node:net";

try {
  const action = process.argv[2];
  if (action === "check") {
    const socket = createConnection({ host: "127.0.0.1", port: 8080 });
    socket.setTimeout(2000);
    socket.on("connect", () => socket.end());
    socket.on("error", () => {
      process.exitCode = 1;
    });
    socket.on("timeout", () => {
      socket.destroy();
      process.exitCode = 1;
    });
  } else {
    if (!["migrate", "serve"].includes(action)) throw new Error();
    const role = action === "migrate" ? "migrate" : "ingest";
    const password = (await readFile(`/run/secrets/${role}`, "utf8")).replace(
      /\n+$/,
      "",
    );
    if (!password) throw new Error();
    const url = new URL("postgresql://db/telemetry");
    url.username = `telemetry_${role}`;
    url.password = password;
    process.env.TELEMETRY_DATABASE_URL = url.toString();
    if (action === "serve") {
      const ip = process.env.TELEMETRY_PROXY_IP;
      if (!ip || !isIP(ip)) throw new Error();
      await writeFile(
        "/tmp/collector.json",
        JSON.stringify({
          listenHost: "0.0.0.0",
          listenPort: 8080,
          trustedProxies: [ip],
        }),
        { mode: 0o600 },
      );
    }
    process.argv = [
      process.execPath,
      "/opt/telemetry/collector.mjs",
      action,
      ...(action === "serve" ? ["/tmp/collector.json"] : []),
    ];
    // The standalone bundle is staged beside this adapter only in the image.
    const bundle = new URL("./collector.mjs", import.meta.url);
    await import(bundle.href);
  }
} catch {
  process.stderr.write("Collector configuration failed.\n");
  process.exitCode = 1;
}
