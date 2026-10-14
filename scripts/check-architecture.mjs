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
];

const violations = [];

for (const [directory, area] of areas) {
  for (const file of await sourceFiles(path.join(root, directory))) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
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
      return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)
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

function forbiddenImport(area, file, specifier) {
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
