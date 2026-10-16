import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareClaudeRuntime } from './claude-runtime.mjs';

// Packaging must select the requested target, retain notices, and fail rather
// than ship a missing or mismatched optional SDK dependency.
for (const [platform, arch] of [['darwin', 'arm64'], ['linux', 'x64'], ['win32', 'x64']]) {
  test(`stages the SDK Claude runtime for ${platform}/${arch}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'app-claude-package-'));
    try {
      const sdk = path.join(root, 'node_modules/@anthropic-ai/claude-agent-sdk');
      const native = `${sdk}-${platform}-${arch}`;
      const executable = platform === 'win32' ? 'claude.exe' : 'claude';
      await mkdir(sdk, { recursive: true }); await mkdir(native);
      await writeFile(path.join(sdk, 'package.json'), JSON.stringify({ version: '0.3.226', claudeCodeVersion: '2.1.226', optionalDependencies: { [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`]: '0.3.226' } }));
      await writeFile(path.join(native, 'package.json'), JSON.stringify({ version: '0.3.226' }));
      await writeFile(path.join(native, executable), `native-${platform}-${arch}`);
      await writeFile(path.join(native, 'LICENSE.md'), 'SDK license');
      await writeFile(path.join(native, 'README.md'), 'Native runtime notices');
      const outputDir = path.join(root, 'resources/claude');
      const input = { root, platform, arch, outputDir };
      const output = await prepareClaudeRuntime(input);
      assert.equal(await readFile(output, 'utf8'), `native-${platform}-${arch}`);
      assert.equal(await readFile(path.join(outputDir, 'LICENSE.md'), 'utf8'), 'SDK license');
      assert.equal(await readFile(path.join(outputDir, 'README.md'), 'utf8'), 'Native runtime notices');
      assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, 'release.json'), 'utf8')), { sdkVersion: '0.3.226', version: '2.1.226', platform, arch });
      if (process.platform !== 'win32') assert.ok((await stat(output)).mode & 0o111);
      await writeFile(path.join(native, 'package.json'), JSON.stringify({ version: '0.3.225' }));
      await assert.rejects(prepareClaudeRuntime(input), /version/i);
      await rm(native, { recursive: true });
      await assert.rejects(prepareClaudeRuntime(input), /optional dependency|not installed/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
