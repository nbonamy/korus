import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// autolib's Node-API binaries use a package-specific filename. Forge's
// prebuildify detector needs a runtime/Node-API tag to recognize them.
export function prepareNativePrebuilds(
  nodeModules: string,
  platform: string = process.platform,
  arch: string = process.arch,
): void {
  const directory = path.join(nodeModules, 'autolib', 'prebuilds', `${platform}-${arch}`);
  const source = path.join(directory, 'autolib.node');
  if (!existsSync(source)) return;
  const extension = arch === 'arm64' ? 'armv8.node' : arch === 'armv7l' ? 'armv7.node' : 'node';
  copyFileSync(source, path.join(directory, `node.napi.${extension}`));
}
