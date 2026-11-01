import { createRequire } from 'node:module';
import type { Autolib } from 'autolib';

const require = createRequire(__filename);

export function loadNativeAutomation(): Autolib {
  const loaded = require('autolib') as Autolib | { default: Autolib };
  return 'default' in loaded ? loaded.default : loaded;
}
