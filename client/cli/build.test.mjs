import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { buildCli } from './build.mjs';
import product from '../../core/src/product.json' with { type: 'json' };
import workspace from './package.json' with { type: 'json' };
const exec = promisify(execFile);

// Builds the distributable and launches multiple real Node processes.
test('the distributable CLI runs in an empty directory without app, daemon, provider dependencies or migrations', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'standalone-cli-package-'));
  try {
    const target = path.join(directory, 'package');
    await buildCli({ outdir: target });
    const metadata = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
    assert.equal(metadata.name, product.cliPackageName);
    assert.equal(metadata.name, '@korus-dev/cli');
    assert.deepEqual(metadata.publishConfig, { access: 'public' });
    assert.equal(metadata.repository.url, 'https://github.com/Korus-Dev/korus');
    assert.equal(metadata.bin[product.slug], 'cli.mjs');
    assert.equal(metadata.version, workspace.version);
    assert.deepEqual(metadata.engines, { node: '>=22' });
    assert.notEqual(metadata.private, true);
    assert.equal(metadata.license, 'Apache-2.0');
    const env = { ...process.env, APP_HOME: path.join(directory, 'missing-home'), PATH: '', KORUS_HOME: '', APP_BACKEND_SOCKET: '', KORUS_APP_PATH: path.join(directory, 'NoApp.app') };
    const help = await exec(process.execPath, [path.join(target, 'cli.mjs'), '--help'], { cwd: directory, env });
    assert.match(help.stdout, /triage/);
    assert.match(help.stdout, /support bundle/);
    const result = await exec(process.execPath, [path.join(target, 'cli.mjs'), 'doctor', '--json', '--timeout', '20'], { cwd: directory, env });
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.daemon.running, false);
    assert.equal(report.healthy, true);
    assert.deepEqual((await readdir(directory)).sort(), ['package']);
    const npmCli = process.env.npm_execpath;
    const packed = await exec(npmCli ? process.execPath : 'npm', [...(npmCli ? [npmCli] : []), 'pack', target, '--ignore-scripts', '--json'], { cwd: directory });
    const packageFiles = JSON.parse(packed.stdout)[0].files.map(file => file.path).sort();
    assert.deepEqual(packageFiles, ['LICENSE', 'README.md', 'cli.mjs', 'package.json']);
    const tarball = path.join(directory, JSON.parse(packed.stdout)[0].filename);
    const prefix = path.join(directory, 'installed');
    await exec(npmCli ? process.execPath : 'npm', [...(npmCli ? [npmCli] : []), 'install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory });
    const installed = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', metadata.name, 'cli.mjs');
    const version = await exec(process.execPath, [installed, '--version'], { cwd: directory, env });
    assert.equal(version.stdout.trim(), `${product.slug} ${metadata.version}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
