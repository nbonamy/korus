import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNativePrebuilds } from '../prepare-native-prebuilds';

describe('prepareNativePrebuilds', () => {
  const fixtures: string[] = [];
  afterEach(() => fixtures.splice(0).forEach((fixture) => rmSync(fixture, { recursive: true, force: true })));
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'native-prebuild-'));
    fixtures.push(root);
    return root;
  }

  it.each([
    ['win32', 'x64', 'node.napi.node'],
    ['darwin', 'arm64', 'node.napi.armv8.node'],
    ['linux', 'x64', 'node.napi.node'],
  ])('makes the %s/%s Node-API binary discoverable by Forge', (platform, arch, filename) => {
    const root = fixture();
    const directory = path.join(root, 'autolib/prebuilds', `${platform}-${arch}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'autolib.node'), Buffer.from([1, 2, 3]));
    prepareNativePrebuilds(root, platform, arch);
    expect(readFileSync(path.join(directory, filename))).toEqual(Buffer.from([1, 2, 3]));
  });

  it('leaves unsupported targets available for source compilation', () => {
    const root = fixture();
    prepareNativePrebuilds(root, 'linux', 'riscv64');
    expect(existsSync(path.join(root, 'autolib'))).toBe(false);
  });
});
