import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AgentBackend, BackendModelOption } from '@workspace/core/contracts';

const modelList = z.array(z.string().trim().min(1));
const schema = z.object({
  models: z.object({ codex: modelList.optional(), claude: modelList.optional(), antigravity: modelList.optional() }).strict().optional(),
}).strict();

export type Requirements = z.infer<typeof schema>;

/** Operator-owned input, separate from settings the app saves. Read once at startup. */
export async function loadRequirements(home: string): Promise<Requirements> {
  const file = path.join(home, 'requirements.json');
  let content: string;
  try { content = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read ${file}.`, { cause: error });
  }
  try { return schema.parse(JSON.parse(content)); }
  catch (error) { throw new Error(`Invalid ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}

export function filterRequiredModels(requirements: Requirements, backend: AgentBackend, models: BackendModelOption[]): BackendModelOption[] {
  const allowed = requirements.models?.[backend];
  if (allowed === undefined) return models;
  const filtered = models.filter(model => allowed.includes(model.model) || allowed.includes(model.id));
  // A removed provider default must not leave selectors pointing at a forbidden model.
  if (filtered.length && !filtered.some(model => model.isDefault)) return filtered.map((model, index) => ({ ...model, isDefault: index === 0 }));
  return filtered;
}
