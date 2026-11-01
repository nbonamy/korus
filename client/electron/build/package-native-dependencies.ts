import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const packagedNativeDependencies = ['autolib', 'node-gyp-build'] as const;

export function copyPackagedNativeDependencies(
  buildPath: string,
  sourceNodeModules = path.resolve(__dirname, '../../../node_modules'),
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return;

  const destinationNodeModules = path.join(buildPath, 'node_modules');
  mkdirSync(destinationNodeModules, { recursive: true });

  for (const dependency of packagedNativeDependencies) {
    const source = path.join(sourceNodeModules, dependency);
    if (!existsSync(source)) {
      throw new Error(`Required packaged dependency is missing: ${dependency}`);
    }

    const destination = path.join(destinationNodeModules, dependency);
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { dereference: true, recursive: true });
  }
}
