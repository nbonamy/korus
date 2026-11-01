import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyPackagedNativeDependencies } from '../package-native-dependencies';

describe('copyPackagedNativeDependencies', () => {
  it('copies the allowlisted hoisted native package and its loader into the packaged app', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'agent-workspace-native-dependencies-'));
    const sourceNodeModules = path.join(fixture, 'source');
    const buildPath = path.join(fixture, 'build');
    for (const dependency of ['autolib', 'node-gyp-build']) {
      const source = path.join(sourceNodeModules, dependency);
      mkdirSync(source, { recursive: true });
      writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: dependency }));
    }

    copyPackagedNativeDependencies(buildPath, sourceNodeModules, 'darwin');

    expect(JSON.parse(readFileSync(
      path.join(buildPath, 'node_modules/autolib/package.json'),
      'utf8',
    ))).toStrictEqual({ name: 'autolib' });
    expect(JSON.parse(readFileSync(
      path.join(buildPath, 'node_modules/node-gyp-build/package.json'),
      'utf8',
    ))).toStrictEqual({ name: 'node-gyp-build' });
  });

  it('fails packaging when a required native dependency is unavailable', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'agent-workspace-native-dependencies-'));

    expect(() => copyPackagedNativeDependencies(
      path.join(fixture, 'build'),
      path.join(fixture, 'source'),
      'darwin',
    )).toThrow('Required packaged dependency is missing: autolib');
  });

  it('does not package macOS automation dependencies on Linux', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'agent-workspace-native-dependencies-'));
    const buildPath = path.join(fixture, 'build');

    copyPackagedNativeDependencies(buildPath, path.join(fixture, 'missing'), 'linux');

    expect(() => readFileSync(
      path.join(buildPath, 'node_modules/autolib/package.json'),
      'utf8',
    )).toThrow();
  });
});
