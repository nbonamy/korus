import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { product } from '@workspace/core/product';

export function copyPackagedClaudeRuntime(buildPath: string, platform: string, arch: string): void {
  const resources = platform === 'darwin'
    ? path.join(buildPath, `${product.name}.app`, 'Contents', 'Resources')
    : path.join(buildPath, 'resources');
  execFileSync(process.execPath, [
    path.resolve(__dirname, '../../scripts/prepare-claude-runtime.mjs'),
    '--platform', platform, '--arch', arch, '--output', path.join(resources, 'claude'),
  ], { stdio: 'inherit' });
}
