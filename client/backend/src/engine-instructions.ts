import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HarnessProvider, AppGeneralSettings } from '@workspace/core/contracts';
import { claudeConfigDirectory } from './claude/config-directory';
import { backendCodexHomeDir } from './state';

function instructionPath(engine: HarnessProvider, homes?: AppGeneralSettings['providerHomes']): string {
  if (engine === 'codex') return path.join(homes?.codex?.homePath ?? backendCodexHomeDir(), 'AGENTS.md');
  if (engine === 'claude') return path.join(homes?.claude?.homePath ?? claudeConfigDirectory(), 'CLAUDE.md');
  if (engine === 'antigravity') return path.join(homes?.antigravity?.homePath ?? path.join(os.homedir(), '.gemini'), 'GEMINI.md');
  throw new Error('Unknown instruction engine.');
}

/** The harnesses whose instruction file Korus edits. */
export function isInstructionEngine(value: unknown): value is 'codex' | 'claude' | 'antigravity' {
  return value === 'codex' || value === 'claude' || value === 'antigravity';
}

export async function readEngineInstructions(engine: HarnessProvider, homes?: AppGeneralSettings['providerHomes']): Promise<{ path: string; text: string }> {
  const file = instructionPath(engine, homes);
  try {
    return { path: file, text: await readFile(file, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: file, text: '' };
    throw error;
  }
}

export async function saveEngineInstructions(input: { engine: HarnessProvider; text: string; all?: boolean; confirmed?: boolean; engines?: HarnessProvider[] }, homes?: AppGeneralSettings['providerHomes']): Promise<void> {
  instructionPath(input.engine, homes);
  if (typeof input.text !== 'string' || (input.all !== undefined && typeof input.all !== 'boolean')) throw new Error('Invalid instruction input.');
  if (input.all && input.confirmed !== true) throw new Error('Overwriting both instruction files requires confirmation.');
  const engines: HarnessProvider[] = input.all ? input.engines ?? ['codex', 'claude'] : [input.engine];
  for (const engine of engines) instructionPath(engine, homes);
  for (const engine of engines) {
    const file = instructionPath(engine, homes);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, input.text, { encoding: 'utf8', mode: 0o600 });
  }
}
