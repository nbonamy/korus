import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Korus talks to every harness through the SDK's neutral methods, events and capabilities. A provider is named only
// where that is the point: setting a harness up, installing it, signing in, storing what it hands out, the phone's wire
// format, and the one table of what each harness can do. Everything else must not know which harness it talks to.
// This list may only shrink.
export const allowed = {
  setup: [
    // Each harness's own install, update, lifecycle and launch modules.
    /^client\/backend\/src\/(codex|claude|cursor|antigravity)\//,
    /^client\/backend\/src\/(provider-lifecycle|provider-update-runtime|runtime|engine-instructions|harness-drivers)\.ts$/,
    // Installing harnesses on SSH hosts, and Codex's shared skills and plugins across homes.
    /^client\/backend\/src\/connections\/(remote-engines|ssh-connections)\.ts$/,
    /^client\/backend\/src\/codex-resource-sharing\.ts$/,
    /^core\/src\/runtime-discovery\.ts$/,
    /^core\/src\/contracts\/provider-setup\.ts$/,
    // Settings, onboarding and sign-in screens for each harness.
    /^client\/vue\/src\/components\/(SettingsView|SettingsPersonalizationPanel|SettingsEngineConnectionRow|SettingsBankedResets|FirstRunOnboardingGate|CodexLoginLanding|LocalClaudeAuthenticationDialog|RemoteEngineConnections|RemoteCodexAuthentication|RemoteClaudeAuthentication|ProviderUpdateRow)\.vue$/,
    /^client\/vue\/src\/components\/Settings(Codex|ClaudeCode|Cursor|Antigravity)Panel\.vue$/,
    /^client\/vue\/src\/components\/(settings-tabs|use-first-run-onboarding|use-remote-codex-authentication)\.ts$/,
    // Each harness's name, icon and the words for its own tools.
    /^client\/vue\/src\/components\/ProviderIcon\.vue$/,
    /^client\/vue\/src\/i18n\/surface-messages\.ts$/,
    /^client\/vue\/src\/claude-tool-titles\.ts$/,
  ],
  persistence: [
    // Stored state, its migrations and validation, in the shapes each harness hands out.
    /^client\/backend\/src\/persistence\/(migrations|schema|layout|task-schema)\.ts$/,
    /^client\/backend\/src\/(state-persistence|mission-screenshot-fixture)\.ts$/,
    /^client\/backend\/src\/sharing\/conversation-shares\.ts$/,
    /^core\/src\/(snapshot-guard-metadata|snapshot-guard-collections|snapshot-construction|approval-presets)\.ts$/,
    // Design documents, validated inside the design frame's own bundle, where the SDK is not available.
    /^core\/src\/design\.ts$/,
    // Usage records priced by each provider's own rules.
    /^client\/backend\/src\/usage\/usage-ledger\.ts$/,
    /^client\/backend\/src\/pricing\//,
    /^core\/src\/usage\.ts$/,
    /^client\/vue\/src\/components\/(UsageToolbar\.vue|usage-chart\.ts)$/,
  ],
  wire: [
    // The phone app and its relay name the harnesses they support.
    /^core\/src\/(companion-protocol|companion-projection)\.ts$/,
    // Validation of the events and session data the daemon and its clients exchange.
    /^core\/src\/backend-protocol\//,
    /^mobile\/src\/demo-connector\.ts$/,
  ],
  capabilities: [
    // The one table of what each harness can do in Korus.
    /^core\/src\/provider-capabilities\.ts$/,
  ],
};
// No file imports a provider-specific SDK entry.
const providerEntryImports = [];

const roots = ["core/src", "client/backend/src", "client/electron/src", "client/vue/src", "mobile/src"];
const providers = ["codex", "claude", "cursor", "antigravity"];
// A provider name as a value; `input['cursor']` names a property, not a provider.
const literal = new RegExp(`(?<!\\[)(['"\`])(${providers.join("|")})\\1(?!\\])`);
const entryImport = new RegExp(`from\\s+['"]@korus-dev/multi-agent-sdk/(${providers.join("|")})['"]`);
const isTest = (file) => /(__tests__|\/tests\/|\.spec\.|\.test\.)/.test(file);
const matches = (file, patterns) => patterns.some((pattern) => pattern.test(file));
const allowedFile = (file) => Object.values(allowed).some((patterns) => matches(file, patterns));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|vue|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  }));
  return nested.flat();
}

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

export async function providerNeutralityViolations(root = process.cwd()) {
  const violations = [];
  for (const directory of roots) {
    for (const full of await sourceFiles(path.join(root, directory))) {
      const file = path.relative(root, full);
      if (isTest(file)) continue;
      const lines = withoutComments(await readFile(full, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (!allowedFile(file) && literal.test(line)) violations.push(`${file}:${index + 1}: names a provider: ${line.trim().slice(0, 140)}`);
        if (!matches(file, providerEntryImports) && entryImport.test(line)) violations.push(`${file}:${index + 1}: imports a provider entry of the SDK`);
      });
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = await providerNeutralityViolations();
  if (violations.length) {
    console.error(`Provider-neutrality violations (${violations.length}):\n${violations.join("\n")}\n\nUse a neutral SDK method, event or capability, or a flag in core/src/provider-capabilities.ts.`);
    process.exit(1);
  }
  console.log("Provider neutrality: no provider named outside setup, persistence, the phone wire format and the capability table.");
}
