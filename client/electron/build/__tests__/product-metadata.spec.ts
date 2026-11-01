import { describe, expect, it, vi } from 'vitest';
import { desktopMetadata, writePackagedDesktopIdentity } from '../product-metadata';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('@workspace/core/product', () => ({
  product: { name: 'Example', appId: 'org.example.desktop', protocolScheme: 'example' },
}));

describe('macOS Info.plist', () => {
  it('provides branded permissions and registers the product deep-link scheme', () => {
    expect(desktopMetadata).toStrictEqual({
      NSLocalNetworkUsageDescription: 'Example connects to development services and repositories on your local network.',
      NSMicrophoneUsageDescription: 'Example uses the microphone to transcribe your voice into composer text.',
      ITSAppUsesNonExemptEncryption: false,
      LSMultipleInstancesProhibited: true,
      CFBundleURLTypes: [{ CFBundleURLName: 'org.example.desktop.deep-link', CFBundleURLSchemes: ['example'] }],
    });
  });
});

it('brands the copied package without changing its implementation name or startup entry', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'packaged-identity-'));
  try {
    const manifest = path.join(directory, 'package.json');
    writeFileSync(manifest, JSON.stringify({ name: '@workspace/electron', main: '.vite/build/main.js' }));
    writePackagedDesktopIdentity(directory);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toStrictEqual({
      name: '@workspace/electron', main: '.vite/build/main.js',
      productName: 'Example', desktopName: 'org.example.desktop.desktop',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
