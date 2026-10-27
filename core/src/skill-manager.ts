import type { AgentBackend } from './contracts';

export type SkillManagerInput = { action: 'list' } | { action: 'sync'; name?: string } | { action: 'install'; source: string; backends?: AgentBackend[]; refresh?: boolean } | { action: 'view'; name: string } | { action: 'remove'; name: string; confirmed: true } | { action: 'remove'; names: string[]; confirmed: true };
export type SkillProviderLocation = { backend: AgentBackend; directory: string; discoveryOnly?: boolean };
export type InstalledSkill = {
  name: string; description: string; managed: boolean; builtIn?: boolean; origin?: 'synced'; source?: string; revision?: string;
  collection?: string; collectionSize?: number;
  providers: { backend: AgentBackend; path: string; status: 'installed' | 'missing' | 'conflict'; error?: string }[];
};
export type SkillDocument = { name: string; files: { providers: AgentBackend[]; content: string }[] };
export type SkillManagerState = { document?: SkillDocument; skills: InstalledSkill[]; providers: AgentBackend[]; curated: typeof curatedSkills; issues: string[]; /** Skills each curated pack installed through Korus, by pack name. */ installs?: Record<string, string[]> };

export type CuratedSkill = { name: string; title: string; author: string; description: string; source: string; kind?: 'pack' };
export const curatedSkills: readonly CuratedSkill[] = [
  { name: 'security-audit', title: 'Security audit', author: 'Cloudflare', description: 'Investigate vulnerabilities and verify findings with source evidence.', source: 'https://github.com/cloudflare/security-audit-skill/tree/main/skills/security-audit' },
  { name: 'web-design-guidelines', title: 'Web design guidelines', author: 'Vercel', description: 'Review interfaces for accessibility, usability and design consistency.', source: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines' },
  { name: 'impeccable', title: 'Impeccable', author: 'Paul Bakaus', description: 'Shape, critique and polish interfaces with a complete design toolkit.', source: 'https://github.com/pbakaus/impeccable/tree/main/.agents/skills/impeccable' },
  { name: 'matt-pocock', title: 'Matt Pocock’s skills', author: 'Matt Pocock', description: 'A complete pack for engineering, planning, testing and everyday development.', source: 'https://github.com/mattpocock/skills/tree/main/skills', kind: 'pack' },
  { name: 'superpowers', title: 'Superpowers', author: 'Jesse Vincent', description: 'A complete development workflow: brainstorming, plans, test-driven development, systematic debugging and verification.', source: 'https://github.com/obra/superpowers/tree/main/skills', kind: 'pack' },
  { name: 'pstack', title: 'pstack', author: 'Lauren Tan · community port', description: 'Engineering workflows and principles for investigation, implementation and review.', source: 'https://github.com/backnotprop/pstack/tree/main/skills', kind: 'pack' },
] as const;

/** Read a skill's display fields and Markdown body without executing or modifying its instructions. */
export function parseSkillDocument(content: string, fallbackName: string): { name: string; description: string; body: string } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  const header = front?.[1] ?? '';
  const value = (key: string) => {
    const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(header);
    if (!match) return '';
    const raw = match[1]!.trim();
    if (/^[>|][+-]?$/.test(raw)) {
      const lines: string[] = [];
      for (const line of header.slice(match.index + match[0].length).split(/\r?\n/).slice(1)) {
        if (line && !/^\s/.test(line)) break;
        if (line.trim()) lines.push(line.trim());
      }
      return lines.join(' ');
    }
    return raw.replace(/^(['"])(.*)\1$/, '$2');
  };
  return { name: value('name') || fallbackName, description: value('description'), body: front ? content.slice(front[0].length) : content };
}
