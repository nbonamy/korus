import { product } from '@workspace/core/product';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type SignDarwinBinariesDeps = {
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  execFileSync?: typeof execFileSync;
  logger?: Pick<typeof console, 'log' | 'warn'>;
};

export function signDarwinBinaries(
  buildPath: string,
  _arch: string,
  deps: SignDarwinBinariesDeps = {},
): void {
  const env = deps.env ?? process.env;
  const identity = env.IDENTITY_DARWIN_CODE;
  const logger = deps.logger ?? console;

  if (!identity) {
    logger.log('IDENTITY_DARWIN_CODE not set, skipping macOS helper signing in afterCopyExtraResources');
    return;
  }

  const existsSync = deps.existsSync ?? fs.existsSync;
  const run = deps.execFileSync ?? execFileSync;
  const binaries = resolveDarwinBinaryPaths(buildPath, existsSync);
  for (const binary of binaries) {
    if (!existsSync(binary.path)) {
      throw new Error(`${binary.label} not found for signing: ${binary.path}`);
    }

    run('codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      identity,
      ...(binary.label === 'Node runtime' ? ['--timestamp', '--entitlements', path.resolve(__dirname, 'Entitlements.darwin.plist')] : []),
      ...(binary.label === 'Claude runtime' ? ['--timestamp', '--preserve-metadata=entitlements'] : []),
      binary.path,
    ], {
      stdio: 'inherit',
    });
  }
}

function resolveDarwinBinaryPaths(
  buildPath: string,
  existsSync: (filePath: string) => boolean,
): Array<{ label: string; path: string }> {
  const normalizedBuildPath = path.normalize(buildPath);
  const resourcesAppPath = path.basename(normalizedBuildPath) === 'app'
    && path.basename(path.dirname(normalizedBuildPath)) === 'Resources'
    ? path.dirname(normalizedBuildPath)
    : null;

  const resourcePaths = [
    resourcesAppPath,
    path.extname(normalizedBuildPath) === '.app'
      ? path.join(normalizedBuildPath, 'Contents', 'Resources')
      : null,
    path.join(normalizedBuildPath, `${product.name}.app`, 'Contents', 'Resources'),
    path.join(normalizedBuildPath, 'Electron.app', 'Contents', 'Resources'),
    path.join(normalizedBuildPath, 'Contents', 'Resources'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const binaryPaths = resourcePaths.flatMap((resourcePath) => [
    {
      label: 'Apple speech helper',
      path: path.join(resourcePath, 'apple-speechanalyzer-cli'),
    },
    {
      label: 'Apple speech helper',
      path: path.join(resourcePath, 'assets', 'apple-speechanalyzer-cli'),
    },
  ]);
  const computerUseAppPaths = resourcePaths.map((resourcePath) => ({
    label: 'Computer Use helper app',
    path: path.join(resourcePath, `${product.name} Computer Use.app`),
  }));
  const ttsHelperPaths = resourcePaths.map((resourcePath) => ({
    label: 'TTS helper',
    path: path.join(resourcePath, 'app-tts-helper'),
  }));
  const nodeRuntimePaths = resourcePaths.map((resourcePath) => ({
    label: 'Node runtime',
    path: path.join(resourcePath, 'runtime', 'node'),
  }));

  const claudeRuntimePaths = resourcePaths.map(resourcePath => ({ label: 'Claude runtime', path: path.join(resourcePath, 'claude', 'claude') }));
  const claudeRuntime = claudeRuntimePaths.find(binary => existsSync(binary.path)) ?? claudeRuntimePaths[0];

  const mobileCompanionPaths = resourcePaths.map(resourcePath => ({
    label: 'iOS simulator companion',
    path: path.join(resourcePath, 'mobile-simulator', 'idb_companion'),
  }));

  const appleSpeechHelper = binaryPaths.find((binary) => existsSync(binary.path)) ?? binaryPaths[0];
  const computerUseHelper = computerUseAppPaths.find((binary) => existsSync(binary.path)) ?? computerUseAppPaths[0];
  const ttsHelper = ttsHelperPaths.find((binary) => existsSync(binary.path)) ?? ttsHelperPaths[0];
  const nodeRuntime = nodeRuntimePaths.find((binary) => existsSync(binary.path)) ?? nodeRuntimePaths[0];
  // The companion is optional (absent on hosts without a pinned build). Electron's outer osxSign
  // pass also walks and signs its nested Mach-O resources.
  const mobileCompanion = mobileCompanionPaths.find(binary => existsSync(binary.path));
  return [appleSpeechHelper, computerUseHelper, ttsHelper, nodeRuntime, ...(mobileCompanion ? [mobileCompanion] : []), claudeRuntime];
}
