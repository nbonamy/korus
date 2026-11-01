import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { listClaudeSkills } from '../skills';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'agent-workspace-claude-skills-'));
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

describe('listClaudeSkills', () => {
  it('loads user and project Claude skills from SKILL.md frontmatter', async () => {
    const homeDir = path.join(tempRoot, 'home');
    const repoDir = path.join(tempRoot, 'repo');
    await writeSkill(path.join(homeDir, '.claude', 'skills', 'world-builder'), [
      '---',
      'name: world-builder',
      "description: Create Dorothy's worlds.",
      'short-description: Build a zone',
      'argument-hint: topic',
      '---',
      '',
      '# World Builder',
    ].join('\n'));
    await writeSkill(path.join(repoDir, '.claude', 'skills', 'frontend-polish'), [
      '---',
      'name: frontend-polish',
      'description: "Improve Vue UI polish."',
      'display-name: Frontend Polish',
      'default-prompt: polish the UI',
      '---',
      '',
      '# Frontend Polish',
    ].join('\n'));

    await expect(listClaudeSkills(agentForFolder(repoDir), { homeDir })).resolves.toStrictEqual([
      {
        defaultPrompt: 'polish the UI',
        description: 'Improve Vue UI polish.',
        displayName: 'Frontend Polish',
        enabled: true,
        name: 'frontend-polish',
        path: path.join(repoDir, '.claude', 'skills', 'frontend-polish', 'SKILL.md'),
        providerMetadata: {
          kind: 'claude',
          root: path.join(repoDir, '.claude', 'skills'),
        },
        scope: 'project',
      },
      {
        description: "Create Dorothy's worlds.",
        enabled: true,
        name: 'world-builder',
        path: path.join(homeDir, '.claude', 'skills', 'world-builder', 'SKILL.md'),
        providerMetadata: {
          argumentHint: 'topic',
          kind: 'claude',
          root: path.join(homeDir, '.claude', 'skills'),
        },
        scope: 'user',
        shortDescription: 'Build a zone',
      },
    ]);
  });

  it('lets project skills override global skills with the same name', async () => {
    const homeDir = path.join(tempRoot, 'home');
    const repoDir = path.join(tempRoot, 'repo');
    await writeSkill(path.join(homeDir, '.claude', 'skills', 'reviewer'), [
      '---',
      'name: reviewer',
      'description: Global reviewer.',
      '---',
    ].join('\n'));
    await writeSkill(path.join(repoDir, '.claude', 'skills', 'reviewer'), [
      '---',
      'name: reviewer',
      'description: Repo reviewer.',
      '---',
    ].join('\n'));

    const skills = await listClaudeSkills(agentForFolder(repoDir), { homeDir });

    await expect(listClaudeSkills({ ...agentForFolder(repoDir), folder: null, sessionKind: 'quickChat' }, { homeDir }))
      .resolves.toEqual([expect.objectContaining({ name: 'reviewer', description: 'Global reviewer.', scope: 'user' })]);

    expect(skills).toStrictEqual([
      expect.objectContaining({
        description: 'Repo reviewer.',
        name: 'reviewer',
        path: path.join(repoDir, '.claude', 'skills', 'reviewer', 'SKILL.md'),
        scope: 'project',
      }),
    ]);
  });

  it('returns an empty list when Claude skill folders do not exist', async () => {
    await expect(listClaudeSkills(agentForFolder(path.join(tempRoot, 'repo')), {
      homeDir: path.join(tempRoot, 'home'),
    })).resolves.toStrictEqual([]);
  });

  it('falls back to the directory name when frontmatter is missing a name', async () => {
    const homeDir = path.join(tempRoot, 'home');
    const repoDir = path.join(tempRoot, 'repo');
    await writeSkill(path.join(repoDir, '.claude', 'skills', 'no-frontmatter'), '# No Frontmatter\n');

    await expect(listClaudeSkills(agentForFolder(repoDir), { homeDir })).resolves.toStrictEqual([
      expect.objectContaining({
        enabled: true,
        name: 'no-frontmatter',
        scope: 'project',
      }),
    ]);
  });
});

async function writeSkill(skillRoot: string, content: string): Promise<void> {
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, 'SKILL.md'), content, 'utf8');
}

function agentForFolder(folder: string): Agent {
  return {
    id: 'agent-claude',
    name: 'Claude Pal',
    folder,
    backend: 'claude',
    backendDefaults: { kind: 'claude' },
    status: { type: 'idle' },
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}
