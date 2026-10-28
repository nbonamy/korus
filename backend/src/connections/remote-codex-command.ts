import { product } from '@workspace/core/product';
import { remoteEnvironmentCommand } from './remote-node';

export function remoteCodexVersionCommand(): string {
  // Read the owning host's override; otherwise use its PATH, never an app-private runtime.
  return remoteEnvironmentCommand(`runtime_custom=$(node -e 'const fs = require("fs"); const dir = require("os").homedir() + "/${product.homeDirectory}/"; const read = (name) => { try { return JSON.parse(fs.readFileSync(dir + name, "utf8")); } catch { return null; } }; const value = read("settings.json")?.data?.settings?.codexBinaryPath || read("state.json")?.general?.codexBinaryPath; process.stdout.write(typeof value === "string" ? value.trim() : "")')
if [ -n "$runtime_custom" ]; then "$runtime_custom" --version; else codex --version 2>/dev/null || true; fi`);
}
