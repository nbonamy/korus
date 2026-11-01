import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readEngineInstructions, saveEngineInstructions } from '../engine-instructions';

const homes: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
describe('engine instruction files', () => {
  it('reads and saves Claude personalization in the configured provider home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'app-claude-instructions-')); homes.push(home);
    vi.stubEnv('CLAUDE_CONFIG_DIR', home);
    vi.stubEnv('HOME', path.join(home, 'personal'));
    const file = path.join(home, 'CLAUDE.md');
    expect(await readEngineInstructions('claude')).toEqual({ path: file, text: '' });
    await saveEngineInstructions({ engine: 'claude', text: 'Use the configured instructions.\n' });
    expect(await readFile(file, 'utf8')).toBe('Use the configured instructions.\n');
    expect(await readEngineInstructions('claude')).toEqual({ path: file, text: 'Use the configured instructions.\n' });
  });
  it('reads missing files as empty and saves the selected existing provider home', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'app-instructions-')); homes.push(home);
    const providerHomes = {
      codex: { homePath: path.join(home, '.codex'), isolated: false, shareSkills: true },
      claude: { homePath: path.join(home, '.claude'), isolated: false, shareSkills: true },
    };
    expect(await readEngineInstructions('codex', providerHomes)).toEqual({ path: path.join(home, '.codex/AGENTS.md'), text: '' });
    await saveEngineInstructions({ engine: 'codex', text: '  Keep formatting.\n' }, providerHomes);
    expect((await readEngineInstructions('codex', providerHomes)).text).toBe('  Keep formatting.\n');
    expect((await readEngineInstructions('claude', providerHomes)).text).toBe('');
    await saveEngineInstructions({ engine: 'claude', text: 'Claude only' }, providerHomes);
    await expect(saveEngineInstructions({ engine: 'codex', text: 'Both', all: true }, providerHomes)).rejects.toThrow('confirmation');
    expect((await readEngineInstructions('claude', providerHomes)).text).toBe('Claude only');
    await saveEngineInstructions({ engine: 'codex', text: 'Both', all: true, confirmed: true }, providerHomes);
    expect((await readEngineInstructions('codex', providerHomes)).text).toBe('Both');
    expect((await readEngineInstructions('claude', providerHomes)).text).toBe('Both');
    await saveEngineInstructions({ engine: 'codex', text: '' }, providerHomes);
    expect((await readEngineInstructions('codex', providerHomes)).text).toBe('');
    await expect(readEngineInstructions('../bad' as never, providerHomes)).rejects.toThrow('Unknown');
  });
});
