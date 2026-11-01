import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { product } from '@workspace/core/product';

export function copyPackagedNodeRuntime(
  buildPath: string,
  platform: string,
  arch: string,
  run: typeof execFileSync = execFileSync,
): void {
  const resources = platform === 'darwin'
    ? path.join(buildPath, `${product.name}.app`, 'Contents', 'Resources')
    : path.join(buildPath, 'resources');
  run(process.execPath, [
    path.resolve(__dirname, '../../../scripts/prepare-node-runtime.mjs'),
    '--platform', platform, '--arch', arch,
    '--output', path.join(resources, 'runtime'),
  ], { stdio: 'inherit' });
}
