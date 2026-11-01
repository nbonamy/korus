import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeToolFileActivity,
  claudeToolPart,
  claudeToolPartInputUpdate,
  completedClaudeToolPart,
} from '../claude-tool-part-adapter';

describe('Claude tool part adapter', () => {
  it.each(['browser screenshot', 'select:mcp__korus__list_agents', ''])('preserves tool search context through streaming and completion: %s', (query) => {
    const part = claudeToolPart({ type: 'tool_use', id: 'search-1', name: 'ToolSearch', input: { query } });
    const descriptor = { source: 'claude', action: 'search', phase: 'running', params: { scope: 'tools', ...(query ? { target: query } : {}) } };
    expect(part.input).toEqual({ query });
    expect(JSON.parse(part.statusText!)).toEqual(descriptor);
    expect(claudeToolPartInputUpdate(part).statusText).toBe(part.statusText);
    for (const phase of ['completed', 'failed'] as const) {
      expect(JSON.parse(completedClaudeToolPart(part, phase, undefined, '').statusText!)).toEqual({ ...descriptor, phase });
    }
  });

  it('preserves Bash commands and descriptions as a command tool', () => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'bash-1',
      name: 'Bash',
      input: {
        command: 'npm test',
        description: 'Run the test suite',
      },
    }, { cwd: '/workspace/project' });

    expect(part).toStrictEqual({
      type: 'tool',
      id: 'bash-1',
      kind: 'command',
      title: 'npm test',
      status: 'running',
      statusText: JSON.stringify({
        source: 'claude',
        action: 'run',
        phase: 'running',
        params: { target: 'npm test' },
      }),
      input: {
        command: 'npm test',
        description: 'Run the test suite',
        cwd: '/workspace/project',
      },
      metadata: {
        provider: 'claude',
        itemType: 'tool_use',
        claudeToolName: 'Bash',
      },
    });
  });

  it('maps reads to linked file inputs and file activity', () => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'read-1',
      name: 'Read',
      input: { file_path: 'README.md', offset: 10 },
    }, { cwd: '/workspace/project' });

    expect(part).toMatchObject({
      kind: 'command',
      title: 'Read',
      input: {
        file_path: 'README.md',
        offset: 10,
        path: '/workspace/project/README.md',
        cwd: '/workspace/project',
      },
      statusText: JSON.stringify({
        source: 'claude',
        action: 'read',
        phase: 'running',
        params: { target: 'README.md' },
      }),
    });
    expect(claudeToolFileActivity(part)).toStrictEqual({
      action: 'read',
      path: '/workspace/project/README.md',
    });
  });

  describe('Bash commands Codex would classify', () => {
    const bash = (command: string) => claudeToolPart(
      { type: 'tool_use', id: 'bash-x', name: 'Bash', input: { command } },
      { cwd: '/workspace/project' },
    );

    it('presents a file read like Codex, with a linkable path', () => {
      const part = bash('cat src/app.ts README.md');
      expect(part.title).toBe('cat src/app.ts README.md');
      expect(JSON.parse(part.statusText!)).toStrictEqual({
        source: 'claude',
        action: 'read',
        phase: 'running',
        params: { names: ['app.ts', 'README.md'], target: 'app.ts, README.md' },
      });
      expect(part.input).toMatchObject({
        command: 'cat src/app.ts README.md',
        commandActions: [
          { type: 'read', name: 'app.ts', path: '/workspace/project/src/app.ts' },
          { type: 'read', name: 'README.md', path: '/workspace/project/README.md' },
        ],
      });
      expect(claudeToolFileActivity(part)).toBeNull();
    });

    it('presents directory listings and searches with the same target summaries', () => {
      expect(JSON.parse(bash('ls -la src').statusText!)).toMatchObject({ action: 'list', params: { target: 'src' } });
      expect(JSON.parse(bash('rg -n useState src lib').statusText!)).toMatchObject({
        action: 'search',
        params: { target: '"useState" in src, "useState" in lib' },
      });
      expect(JSON.parse(bash('rg useState').statusText!)).toMatchObject({ action: 'search', params: { target: '"useState"' } });
    });

    it('summarizes long target lists', () => {
      expect(JSON.parse(bash('cat a b c d e').statusText!).params.target).toBe('a, b, c and 2 more');
    });

    it('keeps everything else as a plain run of the command', () => {
      const part = bash('cat src/app.ts | head');
      expect(JSON.parse(part.statusText!)).toMatchObject({ action: 'run', params: { target: 'cat src/app.ts | head' } });
      expect(part.input).not.toHaveProperty('commandActions');
    });
  });

  describe('tools without a file or command shape', () => {
    it('describes them by scope and operation so the host can title them', () => {
      const part = claudeToolPart({
        type: 'tool_use',
        id: 'todo-1',
        name: 'TodoWrite',
        input: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }] },
      });
      expect(part).toMatchObject({ kind: 'generic', title: 'TodoWrite' });
      expect(JSON.parse(part.statusText!)).toStrictEqual({
        source: 'claude',
        action: 'plan',
        phase: 'running',
        params: { scope: 'todos', operation: 'update', total: 2, completed: 1 },
      });
    });

    it('keeps the phase in step with completion', () => {
      const part = claudeToolPart({ type: 'tool_use', id: 'task-1', name: 'TaskCreate', input: { subject: 'Fix login' } });
      expect(JSON.parse(completedClaudeToolPart(part, 'completed', undefined, '').statusText!)).toMatchObject({
        phase: 'completed',
        params: { scope: 'task', operation: 'create', target: 'Fix login' },
      });
    });

    it('titles subagents by their description', () => {
      const part = claudeToolPart({ type: 'tool_use', id: 'agent-1', name: 'Agent', input: { description: 'Review auth', prompt: 'p' } });
      expect(part.title).toBe('Review auth');
      expect(JSON.parse(part.statusText!).params).toStrictEqual({ scope: 'agent', operation: 'delegate', target: 'Review auth' });
    });
  });

  describe('Skill tool', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'claude-skills-'));
      mkdirSync(path.join(root, 'diagnosing-bugs'));
      writeFileSync(path.join(root, 'diagnosing-bugs', 'SKILL.md'), '# skill');
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it('presents a loaded skill as a linked read of its SKILL.md', () => {
      const part = claudeToolPart({
        type: 'tool_use',
        id: 'skill-1',
        name: 'Skill',
        input: { skill: 'diagnosing-bugs', args: 'flaky test' },
      }, { cwd: '/workspace/project', skillRoots: [path.join(root, 'missing'), root] });

      expect(part).toMatchObject({
        kind: 'command',
        title: 'Skill',
        input: {
          skill: 'diagnosing-bugs',
          path: path.join(root, 'diagnosing-bugs', 'SKILL.md'),
        },
        statusText: JSON.stringify({
          source: 'claude',
          action: 'read',
          phase: 'running',
          params: { target: 'Diagnosing Bugs Skill' },
        }),
      });
      expect(claudeToolFileActivity(part)).toBeNull();
    });

    it('keeps a readable title without a link when the skill file cannot be found', () => {
      const part = claudeToolPart({
        type: 'tool_use',
        id: 'skill-2',
        name: 'Skill',
        input: { skill: 'my-plugin:write-the-docs' },
      }, { skillRoots: [root] });

      expect(part.input).toStrictEqual({ skill: 'my-plugin:write-the-docs' });
      expect(JSON.parse(part.statusText!).params).toStrictEqual({ target: 'Write the Docs Skill' });
    });

    it('falls back to the generic tool when no skill name is given', () => {
      const part = claudeToolPart({ type: 'tool_use', id: 'skill-3', name: 'Skill', input: {} });
      expect(part.statusText).toBeUndefined();
      expect(part.kind).toBe('generic');
    });
  });

  it('maps edits to file changes with exact changed-line counts', () => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'edit-1',
      name: 'Edit',
      input: {
        file_path: '/workspace/project/src/app.ts',
        old_string: 'const a = 1;\nconst b = 2;',
        new_string: 'const a = 1;\nconst b = 3;\nconst c = 4;',
      },
    }, { cwd: '/workspace/project' });

    expect(part).toMatchObject({
      kind: 'fileChange',
      title: '1 file change',
      input: {
        path: '/workspace/project/src/app.ts',
        changes: [{
          kind: 'update',
          path: '/workspace/project/src/app.ts',
          addedLines: 2,
          removedLines: 1,
        }],
      },
      metadata: {
        changes: [{
          kind: 'update',
          path: '/workspace/project/src/app.ts',
          addedLines: 2,
          removedLines: 1,
        }],
      },
      statusText: JSON.stringify({
        source: 'claude',
        action: 'edit',
        phase: 'running',
        params: {
          target: 'app.ts',
          addedLines: 2,
          removedLines: 1,
        },
      }),
    });
    expect(claudeToolFileActivity(part)).toStrictEqual({
      action: 'edit',
      path: '/workspace/project/src/app.ts',
    });
  });

  it.each(['workspace', product.mcpServerName])('preserves %s tool identity without exposing private announcement text', (server) => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'mcp-1',
      name: `mcp__${server}__set_status`,
      input: {
        status: 'Testing',
        announcement: { phase: 'start', text: 'A phrase that must not enter renderer state.' },
      },
    });

    expect(part).toMatchObject({
      kind: 'mcp',
      title: `${server}.set_status`,
      input: { status: 'Testing' },
      metadata: {
        provider: 'claude',
        server,
        tool: 'set_status',
      },
    });
    expect(JSON.stringify(part)).not.toContain('phrase that must not');
  });

  it.each(['workspace', product.mcpServerName])('keeps %s finish-turn effects while removing the spoken phrase', (server) => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'mcp-finish',
      name: `mcp__${server}__finish_turn`,
      input: {
        flag: 'ready_for_review',
        announcement: { text: 'A private completion phrase.' },
        celebration: true,
      },
    });

    expect(part).toMatchObject({
      input: {
        flag: 'ready_for_review',
        celebration: true,
      },
    });
    expect(JSON.stringify(part)).not.toContain('private completion phrase');
  });

  it('updates streamed inputs and completed semantic phases', () => {
    const running = claudeToolPart({
      type: 'tool_use',
      id: 'grep-1',
      name: 'Grep',
      input: { pattern: 'TODO', path: 'src' },
    });
    expect(claudeToolPartInputUpdate(running)).toMatchObject({
      itemId: 'grep-1',
      title: 'Grep',
      input: { pattern: 'TODO', path: 'src' },
      fallbackToolPart: running,
    });

    const completed = completedClaudeToolPart(running, 'completed', 'src/app.ts', 'src/app.ts');
    expect(completed).toMatchObject({
      status: 'completed',
      body: 'src/app.ts',
      output: 'src/app.ts',
      statusText: JSON.stringify({
        source: 'claude',
        action: 'search',
        phase: 'completed',
        params: { target: '"TODO" in src' },
      }),
    });
  });
});
