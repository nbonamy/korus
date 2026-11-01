import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppPluginStatus } from '@workspace/core/contracts';
import { backendCodexHomeDir } from './state';

const chromePluginSection = '[plugins."chrome@openai-bundled"]';

export async function loadPluginStatus(codexHome = backendCodexHomeDir()): Promise<AppPluginStatus> {
  try {
    return readChromePluginStatus(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
  } catch {
    return { chromeEnabled: false };
  }
}

export function readChromePluginStatus(config: string): AppPluginStatus {
  let inChromePlugin = false;
  for (const line of config.split(/\r?\n/)) {
    const section = line.trim();
    if (section.startsWith('[')) {
      inChromePlugin = section === chromePluginSection;
      continue;
    }
    if (inChromePlugin) {
      const match = line.match(/^\s*enabled\s*=\s*(true|false)\s*$/);
      if (match) return { chromeEnabled: match[1] === 'true' };
    }
  }
  return { chromeEnabled: false };
}
