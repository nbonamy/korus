import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { copyPackagedNodeRuntime } from '../package-node-runtime';

describe('packaged private Node runtime', () => {
  it.each(['darwin', 'linux', 'win32'])('packages the requested %s target rather than the build host', (platform) => {
    const run = vi.fn();
    copyPackagedNodeRuntime('/staging', platform, 'x64', run);
    expect(run).toHaveBeenCalledWith(process.execPath, [
      path.resolve(__dirname, '../../../../scripts/prepare-node-runtime.mjs'),
      '--platform', platform, '--arch', 'x64', '--output',
      platform === 'darwin' ? `/staging/${product.name}.app/Contents/Resources/runtime` : '/staging/resources/runtime',
    ], { stdio: 'inherit' });
  });
  it('fails packaging when runtime preparation fails', () => {
    expect(() => copyPackagedNodeRuntime('/staging', 'win32', 'arm64', vi.fn(() => {
      throw new Error('Node runtime checksum mismatch');
    }))).toThrow('checksum mismatch');
  });
});
