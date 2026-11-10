import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('local SDK build', () => {
  it('builds root-overridden SDK packages and refreshes their installed artifacts', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'agent-workspace-build-sdk-'));
    temporaryDirectories.push(fixtureRoot);
    const appRoot = path.join(fixtureRoot, 'agent-workspace');
    const sdkRoot = path.join(fixtureRoot, 'libraries');
    const scriptDirectory = path.join(appRoot, 'scripts');
    const fakeBinDirectory = path.join(fixtureRoot, 'bin');
    mkdirSync(scriptDirectory, { recursive: true });
    mkdirSync(fakeBinDirectory, { recursive: true });
    mkdirSync(sdkRoot, { recursive: true });
    writeFileSync(path.join(sdkRoot, 'package.json'), '{}', { flag: 'wx' });

    const packages = [
      ['client/backend', 'multi-agents-sdk'],
      ['client/electron', 'ai-app-sdk'],
    ] as const;
    writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
      overrides: Object.fromEntries(packages.map(([, packageName]) => {
        const packageSlug = packageName.split('/').at(-1)!;
        return [packageName, `file:../libraries/${packageSlug}`];
      })),
    }));
    for (const [workspace, packageName] of packages) {
      const packageSlug = packageName.split('/').at(-1)!;
      const workspacePackagePath = path.join(appRoot, workspace, 'package.json');
      mkdirSync(path.dirname(workspacePackagePath), { recursive: true });
      const workspacePackage = existsSync(workspacePackagePath)
        ? JSON.parse(readFileSync(workspacePackagePath, 'utf8')) as { dependencies?: Record<string, string> }
        : {};
      workspacePackage.dependencies ??= {};
      workspacePackage.dependencies[packageName] = 'latest';
      writeFileSync(workspacePackagePath, JSON.stringify(workspacePackage));

      const sourcePackage = path.join(sdkRoot, packageSlug);
      mkdirSync(path.join(sourcePackage, 'dist'), { recursive: true });
      writeFileSync(path.join(sourcePackage, 'package.json'), JSON.stringify({
        files: ['dist', 'README.md'],
        name: packageName,
      }));
      writeFileSync(path.join(sourcePackage, 'README.md'), `${packageName} fresh readme`);
      writeFileSync(path.join(sourcePackage, 'dist', 'index.js'), `${packageName} fresh build`);

      const installedPackage = path.join(appRoot, 'node_modules', packageSlug);
      mkdirSync(path.join(installedPackage, 'dist'), { recursive: true });
      writeFileSync(path.join(installedPackage, 'package.json'), JSON.stringify({ name: packageName }));
      writeFileSync(path.join(installedPackage, 'dist', 'index.js'), `${packageName} stale build`);
      writeFileSync(path.join(installedPackage, 'dist', 'removed.js'), 'stale output');
    }

    const sourceScript = path.resolve(__dirname, '../../../../../scripts/build-sdk.mjs');
    const fixtureScript = path.join(scriptDirectory, 'build-sdk.mjs');
    writeFileSync(fixtureScript, readFileSync(sourceScript));
    const npmExecutable = path.join(fakeBinDirectory, 'npm-cli.cjs');
    writeFileSync(npmExecutable, 'process.exit(0);\n');

    const result = spawnSync(process.execPath, [fixtureScript], {
      cwd: appRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_execpath: npmExecutable,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    for (const [, packageName] of packages) {
      const packageSlug = packageName.split('/').at(-1)!;
      const installedPackage = path.join(appRoot, 'node_modules', packageSlug);
      expect(readFileSync(path.join(installedPackage, 'dist', 'index.js'), 'utf8')).toBe(
        `${packageName} fresh build`,
      );
      expect(readFileSync(path.join(installedPackage, 'README.md'), 'utf8')).toBe(
        `${packageName} fresh readme`,
      );
      expect(existsSync(path.join(installedPackage, 'dist', 'removed.js'))).toBe(false);
    }
  });
});
