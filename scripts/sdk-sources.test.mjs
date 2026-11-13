import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { sdkSources, sourceTypecheck } from './sdk-sources.mjs';

test('local SDKs without export maps resolve public root, nested and CSS entries to source', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-sources-'));
  const write = (file, content) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  try {
    write('package.json', JSON.stringify({ name: 'consumer' }));
    for (const sdk of ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk']) {
      write(`${sdk}/package.json`, JSON.stringify({
        name: `@korus-dev/${sdk}`, type: 'module', main: './dist/index.js', types: './dist/index.d.ts',
        files: ['dist', '*.js', '*.d.ts', 'electron'],
      }));
      write(`${sdk}/src/index.ts`, 'export const origin = "source";');
    }
    write('agent-ui-sdk/host.js', "export * from './dist/host/contracts.js';");
    write('agent-ui-sdk/src/host/contracts.ts', 'export const origin = "host source";');
    write('agent-ui-sdk/electron/preload.js', "export * from '../dist/electron/preload.js';");
    write('agent-ui-sdk/src/electron/preload.ts', 'export const origin = "preload source";');
    write('agent-ui-sdk/src/vue/styles.css', ':root { color: red; }');
    const selected = sdkSources(root, { SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: root });
    const resolve = specifier => {
      const alias = selected.aliases.find(alias => alias.find.test(specifier));
      assert.ok(alias, `Missing source alias for ${specifier}`);
      return specifier.replace(alias.find, alias.replacement);
    };
    for (const [entry, expected] of [
      ['@korus-dev/agent-ui-sdk', 'source'],
      ['@korus-dev/agent-ui-sdk/host.js', 'host source'],
      ['@korus-dev/agent-ui-sdk/electron/preload.js', 'preload source'],
    ]) assert.equal((await import(pathToFileURL(resolve(entry)).href)).origin, expected);
    assert.equal(resolve('@korus-dev/agent-ui-sdk/styles.css'), path.join(root, 'agent-ui-sdk/src/vue/styles.css'));
    assert.deepEqual(selected.typePaths['@korus-dev/agent-ui-sdk/electron/preload.js'], [path.join(root, 'agent-ui-sdk/electron/preload.d.ts')]);
    assert.equal(selected.aliases.some(alias => alias.find.test('@korus-dev/agent-ui-sdk/private.js')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conditional SDK exports use runtime entries for source and declarations for typechecking', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-exports-'));
  try {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'consumer' }));
    for (const name of ['codex-sdk', 'multi-agent-sdk']) {
      mkdirSync(path.join(root, name));
      writeFileSync(path.join(root, name, 'package.json'), JSON.stringify({ name: `@korus-dev/${name}`, exports: {} }));
    }
    const sdk = path.join(root, 'agent-ui-sdk');
    mkdirSync(path.join(sdk, 'src/vue'), { recursive: true });
    writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@korus-dev/agent-ui-sdk', exports: {
      '.': { types: './dist/types/index.d.ts', default: './dist/vue/index.js' },
      './styles.css': './dist/styles.css',
    } }));
    writeFileSync(path.join(sdk, 'src/vue/entry.ts'), 'export const origin = "entry";');
    writeFileSync(path.join(sdk, 'src/vue/styles.css'), ':root { color: red; }');
    const selected = sdkSources(root, { SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: root }, ['@korus-dev/agent-ui-sdk']);
    assert.deepEqual(selected.paths['@korus-dev/agent-ui-sdk'], [path.join(sdk, 'src/vue/entry.ts')]);
    assert.deepEqual(selected.typePaths['@korus-dev/agent-ui-sdk'], [path.join(sdk, 'dist/types/index.d.ts')]);
    assert.deepEqual(selected.paths['@korus-dev/agent-ui-sdk/styles.css'], [path.join(sdk, 'src/vue/styles.css')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source typechecking shares the consumer Vue identity with SDK declarations', () => {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-vue-types-'));
  const write = (file, content) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  let selected;
  try {
    write('package.json', JSON.stringify({ name: 'consumer' }));
    write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler', noEmit: true, noLib: true, types: [] }, files: ['consumer.ts', 'globals.d.ts'] }));
    write('globals.d.ts', 'interface Array<T> {} interface Boolean {} interface CallableFunction {} interface Function {} interface IArguments {} interface NewableFunction {} interface Number {} interface Object {} interface RegExp {} interface String {}');
    write('consumer.ts', "import type { Ref } from 'vue'; import type { SdkRef } from '@korus-dev/agent-ui-sdk'; let actual!: Ref; const expected: SdkRef = actual;");
    for (const [folder, version] of [['node_modules/vue', '3.5.35'], ['agent-ui-sdk/node_modules/vue', '3.5.45']]) {
      write(`${folder}/package.json`, JSON.stringify({ name: 'vue', version, types: './index.d.ts' }));
      write(`${folder}/index.d.ts`, 'declare const brand: unique symbol; export interface Ref { readonly [brand]: true }');
    }
    for (const sdk of ['codex-sdk', 'multi-agent-sdk', 'agent-ui-sdk']) {
      write(`${sdk}/package.json`, JSON.stringify({ name: `@korus-dev/${sdk}`, main: './dist/index.js', types: './dist/index.d.ts' }));
      write(`${sdk}/src/index.ts`, 'export {};');
      write(`${sdk}/dist/index.d.ts`, "export type { Ref as SdkRef } from 'vue';");
    }
    symlinkSync(path.dirname(require.resolve('typescript/package.json')), path.join(root, 'node_modules/typescript'), process.platform === 'win32' ? 'junction' : 'dir');
    selected = sourceTypecheck(root, ['--project', path.join(root, 'tsconfig.json')], { SDK_LOCAL_SOURCE: '1', SDK_SOURCE_ROOT: root });
    const parsed = ts.getParsedCommandLineOfConfigFile(selected.args[1], {}, ts.sys);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options));
    assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
  } finally {
    selected?.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
