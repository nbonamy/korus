import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = JSON.parse(readFileSync(path.join(root, 'core/src/product.json'), 'utf8'));
const require = createRequire(import.meta.url);

export function prepareDevelopmentShell(projectRoot = root) {
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'electron/package.json'), 'utf8'));
  const shell = path.join(projectRoot, 'electron', '.development-shell');
  mkdirSync(path.join(shell, 'assets'), { recursive: true });
  copyFileSync(path.join(projectRoot, 'electron/assets/icon-dev.png'), path.join(shell, 'assets/icon-dev.png'));
  writeFileSync(path.join(shell, 'package.json'), JSON.stringify({
    name: 'desktop-development-shell', version: manifest.version, productName: product.name,
    desktopName: `${product.appId}.development.desktop`,
    main: path.join(projectRoot, 'electron/.vite/build/main.js'),
  }, null, 2));
  return shell;
}

export function startElectron(platform = process.platform, launch = spawn, args = process.argv.slice(2), prepare = prepareDevelopmentShell) {
  return launch(process.execPath, [
    require.resolve('@electron-forge/cli/dist/electron-forge-start.js'),
    ...(platform === 'linux' ? ['--app-path', prepare()] : []), '--', ...args,
  ], { cwd: path.join(root, 'electron'), stdio: 'inherit', env: process.env });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = startElectron();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => { process.exitCode = code ?? 1; });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
}
