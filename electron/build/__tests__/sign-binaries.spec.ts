import { product } from '@workspace/core/product';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { signDarwinBinaries } from '../sign-binaries';

describe('signDarwinBinaries', () => {
  it('skips signing when the signing identity is not configured', () => {
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    const execFileSync = vi.fn();

    signDarwinBinaries(`/build/${product.name}.app/Contents/Resources/app`, 'arm64', {
      env: {},
      execFileSync,
      logger,
    });

    expect(execFileSync).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('IDENTITY_DARWIN_CODE not set, skipping macOS helper signing in afterCopyExtraResources');
  });

  it('signs the nested helpers from the extraResource location after resources are copied', () => {
    const execFileSync = vi.fn();

    signDarwinBinaries(`/build/${product.name}.app`, 'arm64', {
      env: {
        IDENTITY_DARWIN_CODE: `Developer ID Application: ${product.name}`,
      },
      execFileSync,
      existsSync: (filePath) => [
        `/build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`,
        `/build/${product.name}.app/Contents/Resources/${product.name} Computer Use.app`,
        `/build/${product.name}.app/Contents/Resources/app-tts-helper`,
        `/build/${product.name}.app/Contents/Resources/runtime/node`,
        `/build/${product.name}.app/Contents/Resources/claude/claude`,
        `/build/${product.name}.app/Contents/Resources/mobile-simulator/idb_companion`,
      ].includes(filePath),
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      `Developer ID Application: ${product.name}`,
      `/build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`,
    ], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenNthCalledWith(2, 'codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      `Developer ID Application: ${product.name}`,
      `/build/${product.name}.app/Contents/Resources/${product.name} Computer Use.app`,
    ], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenNthCalledWith(3, 'codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      `Developer ID Application: ${product.name}`,
      `/build/${product.name}.app/Contents/Resources/app-tts-helper`,
    ], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenNthCalledWith(4, 'codesign', [
      '--force', '--verbose', '--options', 'runtime', '--sign',
      `Developer ID Application: ${product.name}`, '--timestamp', '--entitlements',
      path.resolve(__dirname, '../Entitlements.darwin.plist'),
      `/build/${product.name}.app/Contents/Resources/runtime/node`,
    ], { stdio: 'inherit' });
    expect(execFileSync).toHaveBeenNthCalledWith(5, 'codesign', [
      '--force', '--verbose', '--options', 'runtime', '--sign',
      `Developer ID Application: ${product.name}`,
      `/build/${product.name}.app/Contents/Resources/mobile-simulator/idb_companion`,
    ], { stdio: 'inherit' });
    expect(execFileSync).toHaveBeenCalledWith('codesign', expect.arrayContaining([`/build/${product.name}.app/Contents/Resources/claude/claude`, '--preserve-metadata=entitlements']), { stdio: 'inherit' });
    expect(execFileSync).toHaveBeenCalledTimes(6);
  });

  it('supports the afterCopy app directory path used by older signing hooks', () => {
    const execFileSync = vi.fn();

    signDarwinBinaries(`/build/${product.name}.app/Contents/Resources/app`, 'arm64', {
      env: {
        IDENTITY_DARWIN_CODE: `Developer ID Application: ${product.name}`,
      },
      execFileSync,
      existsSync: (filePath) => [
        `/build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`,
        `/build/${product.name}.app/Contents/Resources/${product.name} Computer Use.app`,
        `/build/${product.name}.app/Contents/Resources/app-tts-helper`,
        `/build/${product.name}.app/Contents/Resources/runtime/node`,
        `/build/${product.name}.app/Contents/Resources/claude/claude`,
        `/build/${product.name}.app/Contents/Resources/mobile-simulator/idb_companion`,
      ].includes(filePath),
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      `Developer ID Application: ${product.name}`,
      `/build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`,
    ], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenCalledTimes(6);
  });

  it('supports the afterCopyExtraResources staging root before the app is renamed', () => {
    const execFileSync = vi.fn();

    signDarwinBinaries('/var/folders/electron-packager/tmp-123', 'arm64', {
      env: {
        IDENTITY_DARWIN_CODE: `Developer ID Application: ${product.name}`,
      },
      execFileSync,
      existsSync: (filePath) => [
        '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/apple-speechanalyzer-cli',
        `/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/${product.name} Computer Use.app`,
        '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/app-tts-helper',
        '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/runtime/node',
        '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/claude/claude',
        '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/mobile-simulator/idb_companion',
      ].includes(filePath),
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(execFileSync).toHaveBeenNthCalledWith(1, 'codesign', [
      '--force',
      '--verbose',
      '--options',
      'runtime',
      '--sign',
      `Developer ID Application: ${product.name}`,
      '/var/folders/electron-packager/tmp-123/Electron.app/Contents/Resources/apple-speechanalyzer-cli',
    ], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenCalledTimes(6);
  });

  it('fails when a required helper has not been copied yet', () => {
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };
    const execFileSync = vi.fn();

    expect(() => signDarwinBinaries(`/build/${product.name}.app/Contents/Resources/app`, 'arm64', {
      env: {
        IDENTITY_DARWIN_CODE: `Developer ID Application: ${product.name}`,
      },
      execFileSync,
      existsSync: () => false,
      logger,
    })).toThrow(`Apple speech helper not found for signing: /build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`);

    expect(execFileSync).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('signs the required helpers when the optional iOS companion was not staged', () => {
    const execFileSync = vi.fn();

    signDarwinBinaries(`/build/${product.name}.app/Contents/Resources/app`, 'x64', {
      env: {
        IDENTITY_DARWIN_CODE: `Developer ID Application: ${product.name}`,
      },
      execFileSync,
      existsSync: (filePath) => [
        `/build/${product.name}.app/Contents/Resources/apple-speechanalyzer-cli`,
        `/build/${product.name}.app/Contents/Resources/${product.name} Computer Use.app`,
        `/build/${product.name}.app/Contents/Resources/app-tts-helper`,
        `/build/${product.name}.app/Contents/Resources/runtime/node`,
        `/build/${product.name}.app/Contents/Resources/claude/claude`,
      ].includes(filePath),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(execFileSync).toHaveBeenCalledTimes(5);
  });
});
