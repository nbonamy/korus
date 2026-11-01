import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { builtinModules } from "node:module";

const root = process.cwd();
const areas = [
  ["core/src", "core"],
  ["backend/src", "backend"],
  ["electron/src/main", "electron-main"],
  ["electron/src/preload", "preload"],
  ["mobile/src", "mobile"],
  ["vue/src", "renderer"],
  ["server/frontend/src", "console"],
  ["server/backend/src", "server-backend"],
];

const violations = [];

for (const [directory, area] of areas) {
  for (const file of await sourceFiles(path.join(root, directory))) {
    const source = ts.createSourceFile(
      file,
      file.endsWith(".vue")
        ? [
            ...(await readFile(file, "utf8")).matchAll(
              /<script\b[^>]*>([\s\S]*?)<\/script>/g,
            ),
          ]
            .map((match) => match[1])
            .join("\n")
        : await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const specifier of moduleSpecifiers(source)) {
      const forbidden = forbiddenImport(area, file, specifier);
      if (forbidden)
        violations.push(
          `${path.relative(root, file)}: ${specifier} (${forbidden})`,
        );
    }
    if (isTelemetryProjection(file) || isTelemetryCaller(file)) {
      checkTelemetryCalls(source, file);
    } else {
      // Mixed owners (server/Electron) may have unrelated timers/network. Check
      // only their named telemetry handlers and protocol branches.
      const visit = (node) => {
        const namedHandler =
          (ts.isPropertyDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isFunctionDeclaration(node)) &&
          node.name &&
          /telemetry/i.test(node.name.getText(source));
        const protocolBranch =
          ts.isIfStatement(node) && mentionsTelemetry(node.expression);
        if (namedHandler) checkTelemetryCalls(node, file);
        else if (protocolBranch) checkTelemetryCalls(node.thenStatement, file);
        else ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const visit = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "APP_TELEMETRY_ENDPOINT" &&
        ![
          "backend/src/runtime.ts",
          "electron/src/main/runtime-config.ts",
        ].includes(path.relative(root, file).split(path.sep).join("/"))
      )
        violations.push(
          `${path.relative(root, file)}: telemetry endpoint belongs to runtime configuration only`,
        );
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (violations.length > 0) {
  console.error(
    `Architecture boundary violations:\n${violations.map((violation) => `  ${violation}`).join("\n")}`,
  );
  process.exitCode = 1;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      if (entry.name === "__tests__") return [];
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return entry.isFile() && /(?:\.[cm]?tsx?|\.vue)$/.test(entry.name)
        ? [fullPath]
        : [];
    }),
  );
  return files.flat();
}

function moduleSpecifiers(source) {
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function mentionsTelemetry(node) {
  if (ts.isPropertyAccessExpression(node) && /telemetry/i.test(node.name.text))
    return true;
  return ts.forEachChild(node, mentionsTelemetry) === true;
}

function checkTelemetryCalls(node, file) {
  const forbidden = new Set([
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "setTimeout",
    "setInterval",
    "setImmediate",
  ]);
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : null;
      if (forbidden.has(name))
        violations.push(
          `${path.relative(root, file)}: ${name} (telemetry callers cannot send or schedule delivery)`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(node);
}

function forbiddenImport(area, file, specifier) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const hostedBackend = path.join(root, "server/backend/src");
  const target = specifier.startsWith(".")
    ? path.resolve(path.dirname(file), specifier)
    : null;
  if (
    area === "console" &&
    !(
      [
        "vue",
        "element-plus",
        "element-plus/es/components/button/style/css",
        "element-plus/es/components/input/style/css",
        "element-plus/es/components/date-picker/style/css",
        "element-plus/es/components/select/style/css",
        "element-plus/es/components/option/style/css",
        "element-plus/es/components/segmented/style/css",
        "element-plus/es/components/popover/style/css",
        "element-plus/es/components/tooltip/style/css",
        "@workspace/vue/shared/menu/AppMenuButton.vue",
        "@workspace/vue/shared/form/FormField.vue",
        "@workspace/vue/shared/icons/app-icons",
        "@workspace/vue/shared/menu/menu-chrome.css",
        "../../../electron/assets/icon.svg",
        "@workspace/core/telemetry-metrics",
        "@workspace/core/telemetry-models",
      ].includes(specifier) ||
      (target && isWithin(path.join(root, "server/frontend/src"), target))
    )
  )
    return "private dashboard consumes browser-safe aggregate contracts only";
  if (isWithin(hostedBackend, file)) {
    if (
      !(
        specifier.startsWith("node:") ||
        [
          "pg",
          "zod",
          "@workspace/core/telemetry",
          "@workspace/core/telemetry-metrics",
          "@workspace/core/telemetry-models",
          "@workspace/core/usage",
        ].includes(specifier) ||
        (target && isWithin(hostedBackend, target))
      )
    )
      return "collector must run independently from the daemon, providers and relay";
  } else if (
    (target && isWithin(hostedBackend, target)) ||
    specifier.includes("/collector/") ||
    specifier.startsWith("@workspace/server-backend")
  ) {
    return "collector cannot be embedded in desktop, daemon or relay runtimes";
  }
  if (
    /^backend\/src\/(codex|claude|antigravity|pricing)\//.test(relative) &&
    specifier.includes("telemetry")
  )
    return "provider and pricing code cannot depend on telemetry";
  if (
    (specifier.endsWith("/telemetry/upload-service") ||
      (specifier.startsWith(".") &&
        path
          .resolve(path.dirname(file), specifier)
          .replace(/\.[cm]?[jt]s$/, "") ===
          path.join(root, "backend/src/telemetry/upload-service"))) &&
    relative !== "backend/src/runtime.ts"
  )
    return "only local runtime composes TelemetryUploadService";
  if (
    relative === "backend/src/telemetry/upload-service.ts" &&
    ![
      "node:crypto",
      "node:fs/promises",
      "node:path",
      "@workspace/core/telemetry",
      "@workspace/core/telemetry-consent",
      "@workspace/core/usage",
      "../usage/usage-service",
    ].includes(specifier)
  )
    return "telemetry uploader consumes only the allowlisted ledger and consent contracts";
  if (
    isTelemetryCaller(file) &&
    [
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:timers",
      "http",
      "https",
      "net",
      "tls",
      "timers",
      "undici",
      "axios",
      "electron",
    ].some((name) => isPackage(specifier, name))
  )
    return "telemetry callers cannot import an alternate transport or scheduler";

  if (
    isTelemetryConsent(file) &&
    ![
      "node:crypto",
      "node:fs/promises",
      "node:path",
      "@workspace/core/telemetry-consent",
      "@workspace/core/usage",
      "../usage/usage-service",
    ].includes(specifier)
  )
    return "telemetry consent cannot depend on transport or scheduling";
  if (isTelemetryProjection(file)) {
    const allowed =
      area === "core"
        ? ["./usage", "./telemetry-models"]
        : [
            "node:fs",
            "node:path",
            "node:sqlite",
            "@workspace/core/usage",
            "@workspace/core/usage-time",
            "@workspace/core/contracts",
            "@workspace/core/telemetry",
            "@workspace/core/provider-conversation-event",
            "./repository-identity",
            "../pricing/catalog",
            "../pricing/schema",
            "../pricing/evaluate",
            "./cost",
            "./usage-ledger",
            "./turn-clock",
          ];
    if (!allowed.includes(specifier))
      return "telemetry projection cannot depend on delivery or provider runtimes";
  }
  if (area === "mobile") {
    const forbiddenPackages = [
      "electron",
      "@workspace/backend",
      "@workspace/electron",
      "@workspace/web",
      "@codex-app-sdk/backend",
      "@codex-app-sdk/electron",
      "@anthropic-ai/claude-agent-sdk",
    ];
    const forbiddenSource =
      specifier.startsWith(".") &&
      ["backend", "electron", "web"].some((directory) =>
        isWithin(
          path.join(root, directory),
          path.resolve(path.dirname(file), specifier),
        ),
      );
    if (
      specifier.startsWith("node:") ||
      builtinModules.includes(specifier) ||
      forbiddenSource ||
      forbiddenPackages.some((name) => isPackage(specifier, name))
    ) {
      return "mobile must use app-owned contracts and browser-safe UI, not desktop, daemon or unauthenticated web transports";
    }
  }
  if (area === "core") {
    if (
      [
        "electron",
        "vue",
        "@vue",
        "@codex-app-sdk/electron",
        "@codex-app-sdk/vue",
        "@codex-app-sdk/web",
      ].some((name) => isPackage(specifier, name))
    ) {
      return "core cannot depend on desktop or UI packages";
    }
    if (
      isFileSystemImport(specifier) &&
      file !== path.join(root, "core", "src", "runtime-discovery.ts")
    ) {
      return "core cannot use Node filesystem APIs";
    }
  }
  if (area === "backend" && isPackage(specifier, "electron")) {
    return "backend cannot depend on Electron";
  }
  if (
    area === "electron-main" &&
    ([
      "@workspace/backend",
      "@codex-app-sdk/backend",
      "@anthropic-ai/claude-agent-sdk",
    ].some((name) => isPackage(specifier, name)) ||
      (specifier.startsWith(".") &&
        isWithin(
          path.join(root, "backend", "src"),
          path.resolve(path.dirname(file), specifier),
        )))
  ) {
    return "Electron main must use the daemon protocol, not backend implementations";
  }
  if (
    area === "preload" &&
    (isFileSystemImport(specifier) ||
      isPackage(specifier, "node:child_process") ||
      isPackage(specifier, "child_process"))
  ) {
    return "preload cannot use raw filesystem or process APIs";
  }
  return null;
}

function isTelemetryCaller(file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  return (
    relative === "electron/src/main/runtime-config.ts" ||
    (relative !== "backend/src/telemetry/upload-service.ts" &&
      /telemetry/i.test(relative))
  );
}

function isTelemetryConsent(file) {
  return (
    path.relative(root, file).split(path.sep).join("/") ===
    "backend/src/telemetry/consent-service.ts"
  );
}

function isTelemetryProjection(file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  return (
    [
      "core/src/telemetry.ts",
      "core/src/telemetry-models.ts",
      "backend/src/usage/usage-ledger.ts",
      "backend/src/usage/usage-service.ts",
    ].includes(relative) || relative.startsWith("backend/src/usage/telemetry")
  );
}

function isPackage(specifier, name) {
  return specifier === name || specifier.startsWith(`${name}/`);
}

function isFileSystemImport(specifier) {
  return isPackage(specifier, "node:fs") || isPackage(specifier, "fs");
}

function isWithin(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
