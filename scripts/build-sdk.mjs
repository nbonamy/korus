import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const sdkDependencies = [
  ['client/backend', 'multi-agents-sdk'],
  ['client/electron', 'ai-app-sdk'],
].map(([directory, packageName]) => {
  const packagePath = path.join(rootDir, directory, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const declaredSpecifier = packageJson.dependencies?.[packageName];
  const overrideSpecifier = rootPackageJson.overrides?.[packageName];
  const specifier = overrideSpecifier ?? declaredSpecifier;
  const specifierBaseDirectory = overrideSpecifier ? rootDir : path.join(rootDir, directory);
  const packageDirectory = typeof specifier === 'string' && specifier.startsWith('file:')
    ? path.resolve(specifierBaseDirectory, specifier.slice('file:'.length))
    : undefined;
  return { directory, packageDirectory, packageName, specifier };
});
const localDependencies = sdkDependencies.filter(({ specifier }) => (
  typeof specifier === 'string' && specifier.startsWith('file:')
));

if (localDependencies.length === 0) {
  console.log('[build:sdk] using the installed SDK packages.');
  process.exit(0);
}
if (localDependencies.length !== sdkDependencies.length) {
  throw new Error('SDK packages must use the same local or published dependency strategy.');
}

const sdkRoots = new Set(localDependencies.map(({ packageDirectory }) => {
  return path.resolve(packageDirectory, '..');
}));
if (sdkRoots.size !== 1) {
  throw new Error('Workspaces resolve SDK packages from different directories.');
}

const sdkRoot = [...sdkRoots][0];
if (!fs.existsSync(path.join(sdkRoot, 'package.json'))) {
  throw new Error(`Local SDK workspace not found at ${sdkRoot}.`);
}

console.log(`[build:sdk] rebuilding local SDK workspace at ${sdkRoot}`);
const npmCli = process.env.npm_execpath;
const result = spawnSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'], { cwd: sdkRoot, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

for (const dependency of localDependencies) {
  refreshInstalledPackage(dependency);
}

function refreshInstalledPackage({ packageDirectory, packageName }) {
  const installedPath = path.join(rootDir, 'node_modules', ...packageName.split('/'));
  if (fs.existsSync(installedPath) && fs.realpathSync(installedPath) === fs.realpathSync(packageDirectory)) return;
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!Array.isArray(packageJson.files)) {
    throw new Error(`Local SDK package ${packageName} must declare package files.`);
  }

  const installedPackageDirectory = path.join(rootDir, 'node_modules', ...packageName.split('/'));
  const stagingDirectory = `${installedPackageDirectory}.refresh-${process.pid}`;
  const previousDirectory = `${installedPackageDirectory}.previous-${process.pid}`;
  const packageEntries = new Set(['package.json', ...packageJson.files]);

  fs.rmSync(stagingDirectory, { force: true, recursive: true });
  fs.rmSync(previousDirectory, { force: true, recursive: true });
  fs.mkdirSync(stagingDirectory, { recursive: true });

  try {
    for (const entry of packageEntries) {
      const source = path.resolve(packageDirectory, entry);
      const relativeSource = path.relative(packageDirectory, source);
      if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
        throw new Error(`Local SDK package ${packageName} contains an invalid file entry: ${entry}`);
      }
      if (!fs.existsSync(source)) {
        throw new Error(`Local SDK package ${packageName} is missing built file entry: ${entry}`);
      }
      fs.cpSync(source, path.join(stagingDirectory, entry), { force: true, recursive: true });
    }

    if (fs.existsSync(installedPackageDirectory)) {
      fs.renameSync(installedPackageDirectory, previousDirectory);
    }
    fs.renameSync(stagingDirectory, installedPackageDirectory);
    fs.rmSync(previousDirectory, { force: true, recursive: true });
  } catch (error) {
    fs.rmSync(stagingDirectory, { force: true, recursive: true });
    if (!fs.existsSync(installedPackageDirectory) && fs.existsSync(previousDirectory)) {
      fs.renameSync(previousDirectory, installedPackageDirectory);
    }
    throw error;
  }

  console.log(`[build:sdk] refreshed installed ${packageName}`);
}
