import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, BackendSkillSummary } from '@workspace/core/contracts';
import { agentFolder } from '@workspace/core/agent-folder';
import { claudeConfigDirectory } from './config-directory';

type ClaudeSkillScope = 'project' | 'user';

export type ClaudeSkillCatalogOptions = {
  homeDir?: string;
};

type ClaudeSkillSource = {
  root: string;
  scope: ClaudeSkillScope;
};
type DirectoryEntry = {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  name: string;
};

export async function listClaudeSkills(agent: Agent, options: ClaudeSkillCatalogOptions = {}): Promise<BackendSkillSummary[]> {
  const folder = agentFolder(agent);
  const sources: ClaudeSkillSource[] = [
    {
      root: path.join(options.homeDir ? path.join(options.homeDir, '.claude') : claudeConfigDirectory(), 'skills'),
      scope: 'user',
    },
    ...(folder ? [{
      root: path.join(folder, '.claude', 'skills'),
      scope: 'project' as const,
    }] : []),
  ];
  const skillsByName = new Map<string, BackendSkillSummary>();

  for (const source of sources) {
    for (const skill of await readSkillsFromSource(source)) {
      skillsByName.set(skill.name, skill);
    }
  }

  return Array.from(skillsByName.values()).sort((left, right) => (
    skillSortLabel(left).localeCompare(skillSortLabel(right))
  ));
}

async function readSkillsFromSource(source: ClaudeSkillSource): Promise<BackendSkillSummary[]> {
  let entries: DirectoryEntry[];
  try {
    entries = await readdir(source.root, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }

  const skills = await Promise.all(entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => readSkill(path.join(source.root, entry.name), entry.name, source)));

  return skills.filter((skill): skill is BackendSkillSummary => Boolean(skill));
}

async function readSkill(skillRoot: string, fallbackName: string, source: ClaudeSkillSource): Promise<BackendSkillSummary | null> {
  const skillPath = path.join(skillRoot, 'SKILL.md');
  let content: string;
  try {
    content = await readFile(skillPath, 'utf8');
  } catch (error) {
    if (isMissingDirectory(error)) {
      return null;
    }
    throw error;
  }

  const frontmatter = parseFrontmatter(content);
  const name = textValue(frontmatter.name) || fallbackName;
  const description = textValue(frontmatter.description);
  const shortDescription = textValue(frontmatter.shortDescription) ||
    textValue(frontmatter.short_description) ||
    textValue(frontmatter['short-description']);
  const displayName = textValue(frontmatter.displayName) ||
    textValue(frontmatter.display_name) ||
    textValue(frontmatter['display-name']);
  const defaultPrompt = textValue(frontmatter.defaultPrompt) ||
    textValue(frontmatter.default_prompt) ||
    textValue(frontmatter['default-prompt']);
  const argumentHint = textValue(frontmatter.argumentHint) ||
    textValue(frontmatter.argument_hint) ||
    textValue(frontmatter['argument-hint']);

  return {
    ...(description ? { description } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(displayName ? { displayName } : {}),
    ...(defaultPrompt ? { defaultPrompt } : {}),
    enabled: true,
    name,
    path: skillPath,
    scope: source.scope,
    providerMetadata: {
      kind: 'claude',
      root: source.root,
      ...(argumentHint ? { argumentHint } : {}),
    },
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) {
    return {};
  }

  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line === '---') {
      return values;
    }
    if (!line.trim() || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('-')) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && value) {
      values[key] = stripYamlScalarQuotes(value);
    }
  }

  return {};
}

function stripYamlScalarQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function textValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function skillSortLabel(skill: BackendSkillSummary): string {
  return (skill.displayName || skill.name).toLowerCase();
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR'].includes(String(error.code));
}
