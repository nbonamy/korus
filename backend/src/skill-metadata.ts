import { parseSkillDocument } from '@workspace/core/skill-manager';

/** Read display metadata without executing or modifying skill instructions. */
export function skillMetadata(content: string, fallbackName: string): { name: string; description: string } {
  const { name, description } = parseSkillDocument(content, fallbackName);
  return { name, description };
}
