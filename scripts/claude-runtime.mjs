import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Stage the SDK-owned runtime for the package target, never the build host. */
export async function prepareClaudeRuntime({ root, platform, arch, outputDir }) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`Unsupported Claude runtime target: ${platform}/${arch}.`);
  }
  const sdkDirectory = path.join(root, 'node_modules/@anthropic-ai/claude-agent-sdk');
  const sdk = JSON.parse(await readFile(path.join(sdkDirectory, 'package.json'), 'utf8'));
  const packageName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const nativeDirectory = path.join(root, 'node_modules', packageName);
  let native;
  try { native = JSON.parse(await readFile(path.join(nativeDirectory, 'package.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Claude SDK optional dependency ${packageName} is not installed. Install optional dependencies for ${platform}/${arch}.`);
  }
  if (native.version !== sdk.version || sdk.optionalDependencies?.[packageName] !== native.version) {
    throw new Error(`Claude runtime version mismatch: ${packageName}@${native.version}, SDK ${sdk.version}.`);
  }
  const executable = platform === 'win32' ? 'claude.exe' : 'claude';
  const source = path.join(nativeDirectory, executable);
  if (!(await stat(source)).isFile()) throw new Error(`Claude runtime is not a file: ${source}.`);
  // Verify notices before emitting a distributable runtime.
  const license = await readFile(path.join(nativeDirectory, 'LICENSE.md'));
  const readme = await readFile(path.join(nativeDirectory, 'README.md'));
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, executable);
  await copyFile(source, output);
  await chmod(output, 0o755);
  await writeFile(path.join(outputDir, 'LICENSE.md'), license);
  await writeFile(path.join(outputDir, 'README.md'), readme);
  await writeFile(path.join(outputDir, 'release.json'), `${JSON.stringify({ sdkVersion: sdk.version, version: sdk.claudeCodeVersion, platform, arch }, null, 2)}\n`);
  return output;
}
