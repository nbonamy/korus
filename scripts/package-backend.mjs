import { chmod, copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import product from '../core/src/product.json' with { type: 'json' };
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDistDir = path.join(rootDir, 'backend/dist');
const resourcesDir = path.join(rootDir, 'electron/resources/daemon');
const backendBundle = path.join(backendDistDir, 'daemon.mjs');
const backendSourceMap = path.join(backendDistDir, 'daemon.mjs.map');

await assertFile(backendBundle);
await assertFile(path.join(backendDistDir, product.daemonName));
await assertSelfContainedBackendBundle(backendBundle);
await mkdir(resourcesDir, { recursive: true });
await copyFile(backendBundle, path.join(resourcesDir, 'daemon.mjs'));
await copyFile(path.join(backendDistDir, product.daemonName), path.join(resourcesDir, product.daemonName));
await chmod(path.join(resourcesDir, product.daemonName), 0o755);
await rm(path.join(resourcesDir, 'node'), { force: true });
await rm(path.join(resourcesDir, 'node.exe'), { force: true });

if (await fileExists(backendSourceMap)) {
  await copyFile(backendSourceMap, path.join(resourcesDir, 'daemon.mjs.map'));
}

console.log(`[package-backend] copied ${path.relative(rootDir, backendBundle)} to ${path.relative(rootDir, resourcesDir)}`);

async function assertFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`${filePath} is not a file`);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Backend bundle is missing: ${filePath}. Run npm run build -w @workspace/backend first.`);
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await assertFile(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Backend bundle is missing:')) {
      return false;
    }
    throw error;
  }
}

async function assertSelfContainedBackendBundle(filePath) {
  const source = await readFile(filePath, 'utf8');
  const imports = [];
  const visit = node => {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier) && !isBundledRuntimeSpecifier(specifier.text)) imports.push(specifier.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
  if (imports.length > 0) {
    throw new Error(`Backend bundle is not self-contained; found external imports: ${[...new Set(imports)].join(', ')}`);
  }
}

function isBundledRuntimeSpecifier(specifier) {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}
