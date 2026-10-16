import { product } from '@workspace/core/product';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG, MakerDMGConfig } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';
import desktopPackage from './package.json';
import { signDarwinBinaries } from './build/sign-binaries';
import { copyPackagedNativeDependencies } from './build/package-native-dependencies';
import { copyPackagedClaudeRuntime } from './build/package-claude-runtime';
import { copyPackagedNodeRuntime } from './build/package-node-runtime';
import { desktopMetadata, writePackagedDesktopIdentity } from './build/product-metadata';
import { prepareNativePrebuilds } from './build/prepare-native-prebuilds';
import { speechHelperResources } from './build/package-speech-helper';

import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

// Forge rebuilds dependencies before preStart, so prepare the selected dev
// target as the config loads. Packaging prepares its explicit target below.
prepareNativePrebuilds(
  path.resolve(__dirname, '../node_modules'),
  process.env.npm_config_platform || process.platform,
  process.env.npm_config_arch || process.arch,
);

// macOS signing/notarization is release-only. Agents should set
// APP_SKIP_SIGNING=1 for local package/build verification.
const skipMacSigning = Boolean(process.env.TEST) || process.env.APP_SKIP_SIGNING === '1';
const extraResource = [
  path.resolve(__dirname, 'assets/icon.png'),
  ...speechHelperResources(__dirname, process.platform),
  'resources/daemon',
  ...(process.platform === 'darwin' ? [`.computer-use/${product.name} Computer Use.app`] : []),
  ...(process.platform === 'darwin' ? ['.tts/app-tts-helper'] : []),
  // Staged only on hosts with a pinned companion (see scripts/prepare-mobile-simulator.mjs).
  ...(process.platform === 'darwin' && fs.existsSync(path.resolve(__dirname, '.mobile-simulator/mobile-simulator'))
    ? ['.mobile-simulator/mobile-simulator']
    : []),
];

// osx special configuration
let osxPackagerConfig = {}
const isDarwin = process.platform == 'darwin';
const dmgOptions: MakerDMGConfig = {
  title: `Install ${product.name}`,
  icon: './assets/icon.icns',
  background: './assets/dmg-background.png',
  iconSize: 128,
  contents: (options) => [{ x: 280, y: 252, type: 'file', path: options.appPath }],
  additionalDMGOptions: {
    window: { size: { width: 560, height: 400 } },
  },
}

if (isDarwin && !skipMacSigning) {
  osxPackagerConfig = {
    osxSign: {
      identity: process.env.IDENTITY_DARWIN_CODE,
      // Signed explicitly with its SDK entitlements before the outer app pass.
      ignore: (filePath: string) => filePath.endsWith(path.join('Resources', 'claude', 'claude')),
      optionsForFile: () => { return {
        hardenedRuntime: true,
        entitlements: './build/Entitlements.darwin.plist',
        'entitlements-inherit': './build/Entitlements.darwin.plist',
      }; },
    },
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    }
  }
}

const config: ForgeConfig = {
  hooks: {
    prePackage: async (_config, platform, arch) => {
      prepareNativePrebuilds(path.resolve(__dirname, '../node_modules'), platform, arch);
    },
  },
  packagerConfig: {
    asar: true,
    icon: process.platform === 'win32' ? '.icons/icon.ico' : 'assets/icon',
    name: product.name,
    appBundleId: product.appId,
    executableName: product.name,
    extraResource,
    extendInfo: desktopMetadata,
    ...osxPackagerConfig,
    afterCopy: [
      (buildPath: string, _electronVersion: string, _platform: string, _arch: string, callback: (error?: Error) => void) => {
        try {
          writePackagedDesktopIdentity(buildPath);
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    ],
    afterCopyExtraResources: [
      (buildPath: string, _electronVersion: string, platform: string, arch: string, callback: (error?: Error) => void) => {
        try {
          copyPackagedNodeRuntime(buildPath, platform, arch);
          copyPackagedClaudeRuntime(buildPath, platform, arch);
          if (platform === 'darwin' && !skipMacSigning) {
            signDarwinBinaries(buildPath, arch);
          }
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    ],
    afterPrune: [
      (buildPath: string, _electronVersion: string, platform: string, _arch: string, callback: (error?: Error) => void) => {
        try {
          copyPackagedNativeDependencies(buildPath, undefined, platform as NodeJS.Platform);
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    ],
  },
  makers: [
    new MakerZIP({}, ['darwin', 'win32', 'linux']),
    new MakerDMG(dmgOptions, ['darwin']),
    // Intentionally unsigned. No certificate or signing service is required.
    new MakerSquirrel({ name: product.slug, authors: product.name, description: `${product.name} desktop`,
      setupIcon: '.icons/icon.ico',
      setupExe: `${product.slug}-${desktopPackage.version}-${process.arch}-setup.exe` }),
    new MakerDeb({ options: { name: product.slug, productName: product.name, bin: product.name,
      maintainer: product.name, homepage: product.websiteUrl, icon: path.resolve(__dirname, 'assets/icon.png') } }),
    new MakerRpm({ options: { name: product.slug, productName: product.name, bin: product.name,
      license: 'Apache-2.0', homepage: product.websiteUrl, icon: path.resolve(__dirname, 'assets/icon.png') } }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
