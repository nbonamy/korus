import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentBackend, AppGeneralSettings } from '@workspace/core/contracts';
import { claudeConfigDirectory } from './claude/config-directory';
import { backendCodexHomeDir } from './state';

function instructionPath(engine: AgentBackend, homes?: AppGeneralSettings['providerHomes']): string {
  if (engine === 'codex') return path.join(homes?.codex?.homePath ?? backendCodexHomeDir(), 'AGENTS.md');
  if (engine === 'claude') return path.join(homes?.claude?.homePath ?? claudeConfigDirectory(), 'CLAUDE.md');
  throw new Error('Unknown instruction engine.');
}

export async function readEngineInstructions(engine: AgentBackend, homes?: AppGeneralSettings['providerHomes']): Promise<{ path: string; text: string }> {
  const file = instructionPath(engine, homes);
  try {
    return { path: file, text: await readFile(file, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: file, text: '' };
    throw error;
  }
}

export async function saveEngineInstructions(input: { engine: AgentBackend; text: string; all?: boolean; confirmed?: boolean }, homes?: AppGeneralSettings['providerHomes']): Promise<void> {
  instructionPath(input.engine, homes);
  if (typeof input.text !== 'string' || (input.all !== undefined && typeof input.all !== 'boolean')) throw new Error('Invalid instruction input.');
  if (input.all && input.confirmed !== true) throw new Error('Overwriting both instruction files requires confirmation.');
  const engines: AgentBackend[] = input.all ? ['codex', 'claude'] : [input.engine];
  for (const engine of engines) {
    const file = instructionPath(engine, homes);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, input.text, { encoding: 'utf8', mode: 0o600 });
  }
}
