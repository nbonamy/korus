import { product } from '@workspace/core/product';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writePackagedDesktopIdentity(buildPath: string): void {
  const manifestPath = path.join(buildPath, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.productName = product.name;
  manifest.desktopName = `${product.appId}.desktop`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export const desktopMetadata = {
  NSLocalNetworkUsageDescription: `${product.name} connects to development services and repositories on your local network.`,
  NSMicrophoneUsageDescription: `${product.name} uses the microphone to transcribe your voice into composer text.`,
  ITSAppUsesNonExemptEncryption: false,
  LSMultipleInstancesProhibited: true,
  CFBundleURLTypes: [{
    CFBundleURLName: `${product.appId}.deep-link`,
    CFBundleURLSchemes: [product.protocolScheme],
  }],
};
