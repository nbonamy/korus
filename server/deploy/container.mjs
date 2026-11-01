import { readFile, writeFile } from "node:fs/promises";
import { isIP, createConnection } from "node:net";

process.stdout.on("error", () => {});
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
    if (!["migrate", "serve", "read", "auth"].includes(action))
      throw new Error();
    if (action === "auth") {
      const local = process.env.TELEMETRY_CONSOLE_ALLOW_LOOPBACK_HTTP ?? "0";
      if (!["0", "1"].includes(local)) throw new Error();
      await writeFile(
        "/tmp/auth.json",
        JSON.stringify({
          listenHost: "0.0.0.0",
          listenPort: 8080,
          consoleOrigin: process.env.TELEMETRY_CONSOLE_ORIGIN,
          allowInsecureLoopback: local === "1",
        }),
        { mode: 0o600 },
      );
      process.argv = [
        process.execPath,
        "/opt/telemetry/collector.mjs",
        "auth",
        "/tmp/auth.json",
      ];
      await import(new URL("./collector.mjs", import.meta.url).href);
    } else {
      const role =
        action === "migrate"
          ? "migrate"
          : action === "read"
            ? "read"
            : "ingest";
      const password = (await readFile(`/run/secrets/${role}`, "utf8")).replace(
        /\n+$/,
        "",
      );
      if (!password) throw new Error();
      const url = new URL("postgresql://db/telemetry");
      url.username = `telemetry_${role}`;
      url.password = password;
      process.env.TELEMETRY_DATABASE_URL = url.toString();
      if (action === "serve" || action === "read") {
        const ip = process.env.TELEMETRY_PROXY_IP;
        if (!ip || !isIP(ip)) throw new Error();
        await writeFile(
          "/tmp/collector.json",
          JSON.stringify({
            listenHost: "0.0.0.0",
            listenPort: 8080,
            ...(action === "serve"
              ? { trustedProxies: [ip] }
              : {
                  consoleOrigin: process.env.TELEMETRY_CONSOLE_ORIGIN,
                  accessTokenFile: "/run/secrets/read_access",
                }),
          }),
          { mode: 0o600 },
        );
      }
      process.argv = [
        process.execPath,
        "/opt/telemetry/collector.mjs",
        action,
        ...(action !== "migrate" ? ["/tmp/collector.json"] : []),
      ];
      // The standalone bundle is staged beside this adapter only in the image.
      const bundle = new URL("./collector.mjs", import.meta.url);
      await import(bundle.href);
    }
  }
} catch (error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  const cause =
    code === "ENOENT"
      ? {
          reason: "file_missing",
          code,
          message: "Required operator file does not exist.",
        }
      : code === "EACCES"
        ? {
            reason: "permission_denied",
            code,
            message: "Permission denied reading an operator file.",
          }
        : {
            reason: "invalid_configuration",
            message:
              "Container bootstrap configuration or secret file is invalid or unavailable.",
          };
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "server",
      event: "startup_failed",
      operation: "configuration",
      ...cause,
    }) + "\n",
  );
  process.exitCode = 1;
}
