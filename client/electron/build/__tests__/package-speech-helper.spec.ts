import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { speechHelperResources } from '../package-speech-helper';

const fixtures: string[] = [];
afterEach(() => fixtures.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('packaged speech helper', () => {
  // Packaging must find the owning SDK's binary with hoisted or nested installs;
  // resolving exports must not load its ESM runtime during Forge configuration.
  it.each(['hoisted', 'workspace', 'linked'])('includes the installed binary from a %s SDK', (layout) => {
    const root = mkdtempSync(path.join(tmpdir(), 'speech-resource-'));
    fixtures.push(root);
    const workspace = path.join(root, 'client/electron');
    mkdirSync(workspace, { recursive: true });
    const sdk = path.join(layout === 'hoisted' ? root : layout === 'workspace' ? workspace : path.join(root, 'libraries'), 'node_modules/@korus-dev/agent-ui-sdk');
    mkdirSync(path.join(sdk, 'assets'), { recursive: true });
    writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({
      name: '@korus-dev/agent-ui-sdk', exports: { '.': { import: './dist/vue/index.js' } },
    }));
    if (layout === 'linked') {
      mkdirSync(path.join(root, 'node_modules/@korus-dev'), { recursive: true });
      symlinkSync(sdk, path.join(root, 'node_modules/@korus-dev/agent-ui-sdk'), process.platform === 'win32' ? 'junction' : 'dir');
    }
    writeFileSync(path.join(sdk, 'assets/apple-speechanalyzer-cli'), 'native speech helper');

    const resources = speechHelperResources(workspace, 'darwin');
    expect(resources).toHaveLength(1);
    expect(readFileSync(resources[0], 'utf8')).toBe('native speech helper');
  });

  it('does not resolve macOS resources for Windows or Linux', () => {
    expect(speechHelperResources('/missing/workspace', 'win32')).toStrictEqual([]);
    expect(speechHelperResources('/missing/workspace', 'linux')).toStrictEqual([]);
  });
});
