import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export function speechHelperResources(workspacePath: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'darwin') return [];
  const sdk = installedPackageRoot(workspacePath, '@korus-dev/agent-ui-sdk');
  return [path.join(sdk, 'assets/apple-speechanalyzer-cli')];
}

function installedPackageRoot(consumerPath: string, packageName: string): string {
  // The SDK exposes ESM entrypoints, not its assets or package.json. Locate its
  // package using Node's consumer search order without loading the SDK runtime.
  const require = createRequire(path.join(consumerPath, 'package.json'));
  const packageRoot = (require.resolve.paths(packageName) ?? [])
    .map((directory) => path.join(directory, packageName))
    .find((directory) => existsSync(path.join(directory, 'package.json')));
  if (!packageRoot) throw new Error(`Required packaged dependency is missing: ${packageName}`);
  return packageRoot;
}
