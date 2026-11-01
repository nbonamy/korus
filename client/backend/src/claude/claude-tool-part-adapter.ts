import { existsSync } from 'node:fs';
import path from 'node:path';
import { isAppMcpServerName } from '@workspace/core/product';
import type { RendererToolPart, RendererToolPartUpdate } from '@workspace/core/contracts';
import { classifyShellCommand, type ClassifiedShellCommand } from './claude-command-classifier';
import { claudeToolSemantics } from './claude-tool-semantics';
import { claudeConfigDirectory } from './config-directory';
import type { ClaudeSdkContentBlock } from './protocol';

type ClaudeToolUseBlock = Extract<ClaudeSdkContentBlock, { type: 'tool_use' }>;
type ClaudeToolStatus = RendererToolPart['status'];

export type ClaudeToolFileActivity = {
  action: 'read' | 'edit' | 'create';
  path: string;
};

export type ClaudeToolPartOptions = {
  cwd?: string;
  /** Skill folders searched in order; defaults to the project's and the user's Claude skills. */
  skillRoots?: string[];
  status?: ClaudeToolStatus;
};

export function claudeToolPart(
  block: ClaudeToolUseBlock,
  options: ClaudeToolPartOptions = {},
): RendererToolPart {
  const status = options.status ?? 'running';
  const input = recordValue(block.input) ?? {};
  const metadata = {
    provider: 'claude',
    itemType: 'tool_use',
    claudeToolName: block.name,
  } satisfies Record<string, unknown>;

  if (block.name === 'Bash') {
    const command = stringValue(input.command);
    const cwd = options.cwd && input.cwd === undefined ? options.cwd : stringValue(input.cwd);
    const classified = command ? classifyShellCommand(command) : null;
    const presentation = command && classified ? shellCommandPresentation(command, classified, cwd) : null;
    return toolPart(block, {
      kind: 'command',
      title: command ?? 'Bash',
      status,
      input: {
        ...input,
        ...(options.cwd && input.cwd === undefined ? { cwd: options.cwd } : {}),
        ...(presentation ? { commandActions: presentation.commandActions } : {}),
      },
      ...(command ? { statusText: presentation ? toolStatus(presentation.action, status, presentation.params) : toolStatus('run', status, { target: command }) } : {}),
      metadata,
    });
  }

  if (block.name === 'Read') {
    const filePath = stringValue(input.file_path);
    return fileToolPart(block, {
      action: 'read',
      filePath,
      kind: 'command',
      metadata,
      options,
      status,
      title: 'Read',
      input,
    });
  }

  if (block.name === 'Write') {
    const filePath = stringValue(input.file_path);
    return fileChangeToolPart(block, {
      action: 'edit',
      changeKind: 'update',
      filePath,
      input,
      metadata,
      options,
      status,
    });
  }

  if (block.name === 'Edit') {
    const filePath = stringValue(input.file_path);
    const lineDiff = input.replace_all === true
      ? undefined
      : changedLineCount(stringValue(input.old_string), stringValue(input.new_string));
    return fileChangeToolPart(block, {
      action: 'edit',
      changeKind: 'update',
      filePath,
      input,
      lineDiff,
      metadata,
      options,
      status,
    });
  }

  if (block.name === 'NotebookEdit') {
    const filePath = stringValue(input.notebook_path);
    return fileChangeToolPart(block, {
      action: 'edit',
      changeKind: 'update',
      filePath,
      input,
      metadata,
      options,
      status,
    });
  }

  if (block.name === 'Glob') {
    const pattern = stringValue(input.pattern);
    const searchPath = stringValue(input.path);
    const target = searchTarget(pattern, searchPath);
    return toolPart(block, {
      kind: 'command',
      title: 'Glob',
      status,
      input,
      ...(target ? { statusText: toolStatus('list', status, { target }) } : {}),
      metadata,
    });
  }

  if (block.name === 'Grep') {
    const pattern = stringValue(input.pattern);
    const searchPath = stringValue(input.path);
    const target = searchTarget(pattern ? `"${pattern}"` : undefined, searchPath);
    return toolPart(block, {
      kind: 'command',
      title: 'Grep',
      status,
      input,
      ...(target ? { statusText: toolStatus('search', status, { target }) } : {}),
      metadata,
    });
  }

  if (block.name === 'ToolSearch') {
    const query = stringValue(input.query);
    return toolPart(block, {
      kind: 'generic',
      title: 'ToolSearch',
      status,
      input,
      statusText: toolStatus('search', status, { scope: 'tools', ...(query ? { target: query } : {}) }),
      metadata,
    });
  }

  if (block.name === 'WebSearch') {
    const query = stringValue(input.query);
    return toolPart(block, {
      kind: 'webSearch',
      title: 'Web search',
      status,
      input,
      ...(query ? { statusText: toolStatus('search', status, { target: query }) } : {}),
      metadata: { ...metadata, ...(query ? { query } : {}) },
    });
  }

  if (block.name === 'WebFetch') {
    const url = stringValue(input.url);
    return toolPart(block, {
      kind: 'webSearch',
      title: 'Web fetch',
      status,
      input,
      ...(url ? { statusText: toolStatus('read', status, { target: url }) } : {}),
      metadata: { ...metadata, ...(url ? { url } : {}) },
    });
  }

  const semantics = claudeToolSemantics(block.name, input);
  if (semantics) {
    return toolPart(block, {
      kind: 'generic',
      title: semantics.title ?? block.name,
      status,
      input,
      statusText: toolStatus(semantics.action, status, { scope: semantics.scope, operation: semantics.operation, ...semantics.params }),
      metadata,
    });
  }

  const skill = block.name === 'Skill' ? stringValue(input.skill) : undefined;
  if (skill) {
    const skillPath = findSkillFile(skill, options);
    return toolPart(block, {
      kind: 'command',
      title: 'Skill',
      status,
      input: { ...input, ...(skillPath ? { path: skillPath } : {}) },
      statusText: toolStatus('read', status, { target: `${skillDisplayName(skill)} Skill` }),
      metadata,
    });
  }

  const mcp = claudeMcpToolName(block.name);
  if (mcp) {
    const appTool = isAppMcpServerName(mcp.server) ? mcp.tool.replaceAll('_', '-') : '';
    const presentedInput = appTool === 'set-status'
      ? statusInput(input)
      : appTool === 'finish-turn'
        ? finishTurnInput(input)
        : input;
    return toolPart(block, {
      kind: 'mcp',
      title: `${mcp.server}.${mcp.tool}`,
      status,
      input: presentedInput,
      metadata: {
        ...metadata,
        server: mcp.server,
        tool: mcp.tool,
      },
    });
  }

  return toolPart(block, {
    kind: 'generic',
    title: block.name,
    status,
    input: block.input,
    metadata,
  });
}

const SMALL_WORDS = /^(?:a|an|and|at|by|for|in|of|on|or|the|to)$/iu;

/** Matches the conversation UI's naming of a read SKILL.md, so the link and label agree. */
function skillDisplayName(skill: string): string {
  const name = skill.split(':').at(-1) ?? skill;
  return name.split(/[-_\s]+/u).filter(Boolean).map((word, index) => (
    index > 0 && SMALL_WORDS.test(word) ? word.toLowerCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
  )).join(' ');
}

function findSkillFile(skill: string, options: ClaudeToolPartOptions): string | undefined {
  const name = skill.split(':').at(-1);
  if (!name || name.includes('/') || name.includes('\\') || name === '..') return undefined;
  const roots = options.skillRoots ?? [
    ...(options.cwd ? [path.join(options.cwd, '.claude', 'skills')] : []),
    path.join(claudeConfigDirectory(), 'skills'),
  ];
  return roots.map((root) => path.join(root, name, 'SKILL.md')).find((candidate) => existsSync(candidate));
}

type ShellCommandPresentation = {
  action: 'list' | 'read' | 'search';
  params: Record<string, unknown>;
  commandActions: Record<string, unknown>[];
};

/** Mirrors the read/list/search actions and target summaries Codex reports for the same commands. */
function shellCommandPresentation(command: string, classified: ClassifiedShellCommand, cwd?: string): ShellCommandPresentation {
  const resolved = (file: string) => fullPath(file, cwd) ?? file;
  if (classified.action === 'read') {
    const names = unique(classified.files.map((file) => path.basename(file)));
    return {
      action: 'read',
      params: { names, target: summarizeTargets(names, command) },
      commandActions: classified.files.map((file) => ({ type: 'read', command, name: path.basename(file), path: resolved(file) })),
    };
  }
  if (classified.action === 'list') {
    return {
      action: 'list',
      params: { targets: classified.paths, target: summarizeTargets(classified.paths, command) },
      commandActions: classified.paths.map((target) => ({ type: 'listFiles', command, path: resolved(target) })),
    };
  }
  const targets = unique(classified.paths.length
    ? classified.paths.map((target) => (classified.pattern ? `"${classified.pattern}" in ${target}` : target))
    : classified.pattern ? [`"${classified.pattern}"`] : []);
  return {
    action: 'search',
    params: { targets, target: summarizeTargets(targets, command) },
    commandActions: classified.paths.length
      ? classified.paths.map((target) => ({ type: 'search', command, query: classified.pattern, path: resolved(target) }))
      : [{ type: 'search', command, query: classified.pattern }],
  };
}

function summarizeTargets(targets: string[], fallback: string): string {
  if (targets.length === 0) return fallback;
  return targets.length <= 3 ? targets.join(', ') : `${targets.slice(0, 3).join(', ')} and ${targets.length - 3} more`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function statusInput(input: Record<string, unknown>): Record<string, unknown> {
  return typeof input.status === 'string' ? { status: input.status } : {};
}

function finishTurnInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof input.flag === 'string' ? { flag: input.flag } : {}),
    ...(typeof input.celebration === 'boolean'
      ? { celebration: input.celebration }
      : {}),
  };
}

export function claudeToolPartInputUpdate(toolPart: RendererToolPart): RendererToolPartUpdate {
  return {
    itemId: toolPart.id,
    title: toolPart.title,
    status: toolPart.status,
    ...(toolPart.statusText ? { statusText: toolPart.statusText } : { statusText: null }),
    input: toolPart.input,
    metadata: toolPart.metadata,
    fallbackToolPart: toolPart,
  };
}

export function completedClaudeToolPart(
  toolPart: RendererToolPart,
  status: Extract<ClaudeToolStatus, 'completed' | 'failed'>,
  output: unknown,
  body: string,
): RendererToolPart {
  return {
    ...toolPart,
    status,
    ...(toolPart.statusText ? { statusText: statusTextWithPhase(toolPart.statusText, status) } : {}),
    output,
    body,
  };
}

export function claudeToolFileActivity(toolPart: RendererToolPart): ClaudeToolFileActivity | null {
  const input = recordValue(toolPart.input);
  const filePath = stringValue(input?.path) ?? stringValue(input?.file_path) ?? stringValue(input?.notebook_path);
  if (!filePath) {
    return null;
  }

  const absolutePath = fullPath(filePath, stringValue(input?.cwd) ?? stringValue(toolPart.metadata?.cwd));
  if (!absolutePath) {
    return null;
  }

  const toolName = stringValue(toolPart.metadata?.claudeToolName);
  if (toolName === 'Read') {
    return { action: 'read', path: absolutePath };
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    return { action: 'edit', path: absolutePath };
  }
  return null;
}

function fileToolPart(
  block: ClaudeToolUseBlock,
  values: {
    action: 'read';
    filePath?: string;
    input: Record<string, unknown>;
    kind: string;
    metadata: Record<string, unknown>;
    options: ClaudeToolPartOptions;
    status: ClaudeToolStatus;
    title: string;
  },
): RendererToolPart {
  const fullFilePath = values.filePath ? fullPath(values.filePath, values.options.cwd) : undefined;
  const normalizedInput = {
    ...values.input,
    ...(fullFilePath ? { path: fullFilePath } : {}),
    ...(values.options.cwd ? { cwd: values.options.cwd } : {}),
  };
  return toolPart(block, {
    kind: values.kind,
    title: values.title,
    status: values.status,
    input: normalizedInput,
    ...(fullFilePath ? {
      statusText: toolStatus(values.action, values.status, { target: path.basename(fullFilePath) }),
    } : {}),
    metadata: {
      ...values.metadata,
      ...(values.options.cwd ? { cwd: values.options.cwd } : {}),
    },
  });
}

function fileChangeToolPart(
  block: ClaudeToolUseBlock,
  values: {
    action: 'edit';
    changeKind: 'update';
    filePath?: string;
    input: Record<string, unknown>;
    lineDiff?: { addedLines: number; removedLines: number };
    metadata: Record<string, unknown>;
    options: ClaudeToolPartOptions;
    status: ClaudeToolStatus;
  },
): RendererToolPart {
  const fullFilePath = values.filePath ? fullPath(values.filePath, values.options.cwd) : undefined;
  const change = fullFilePath ? {
    kind: values.changeKind,
    path: fullFilePath,
    ...(values.lineDiff ?? {}),
  } : null;
  const changes = change ? [change] : [];
  const descriptorParams = {
    ...(fullFilePath ? { target: path.basename(fullFilePath) } : {}),
    ...(values.lineDiff ?? {}),
  };
  return toolPart(block, {
    kind: 'fileChange',
    title: fullFilePath ? '1 file change' : block.name,
    status: values.status,
    input: {
      ...values.input,
      ...(fullFilePath ? { path: fullFilePath } : {}),
      ...(values.options.cwd ? { cwd: values.options.cwd } : {}),
      ...(changes.length ? { changes } : {}),
    },
    ...(fullFilePath ? { statusText: toolStatus(values.action, values.status, descriptorParams) } : {}),
    metadata: {
      ...values.metadata,
      ...(values.options.cwd ? { cwd: values.options.cwd } : {}),
      ...(changes.length ? { changes } : {}),
    },
  });
}

function toolPart(
  block: ClaudeToolUseBlock,
  values: Omit<RendererToolPart, 'id' | 'type'>,
): RendererToolPart {
  return {
    type: 'tool',
    id: block.id,
    ...values,
  };
}

function toolStatus(
  action: 'edit' | 'list' | 'plan' | 'read' | 'run' | 'search',
  phase: ClaudeToolStatus,
  params: Record<string, unknown>,
): string {
  return JSON.stringify({ source: 'claude', action, phase, params });
}

function statusTextWithPhase(statusText: string, phase: ClaudeToolStatus): string {
  try {
    const descriptor = JSON.parse(statusText) as unknown;
    const descriptorRecord = recordValue(descriptor);
    if (descriptorRecord) {
      return JSON.stringify({ ...descriptorRecord, phase });
    }
  } catch {
    // Keep a non-structured provider status unchanged.
  }
  return statusText;
}

function searchTarget(subject?: string, searchPath?: string): string | undefined {
  if (subject && searchPath) {
    return `${subject} in ${searchPath}`;
  }
  return subject ?? searchPath;
}

export function claudeMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__([^_].*?)__(.+)$/u.exec(name);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { server: match[1], tool: match[2] };
}

function fullPath(filePath: string, cwd?: string): string | undefined {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return cwd ? path.resolve(cwd, filePath) : undefined;
}

function changedLineCount(oldText?: string, newText?: string): { addedLines: number; removedLines: number } | undefined {
  if (oldText === undefined || newText === undefined) {
    return undefined;
  }
  const oldLines = textLines(oldText);
  const newLines = textLines(newText);
  if (oldLines.length * newLines.length > 1_000_000) {
    return undefined;
  }
  const commonLines = longestCommonSubsequenceLength(oldLines, newLines);
  return {
    addedLines: newLines.length - commonLines,
    removedLines: oldLines.length - commonLines,
  };
}

function textLines(value: string): string[] {
  if (!value) {
    return [];
  }
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const [rows, columns] = right.length <= left.length ? [left, right] : [right, left];
  const previous = new Uint32Array(columns.length + 1);
  const current = new Uint32Array(columns.length + 1);
  for (const row of rows) {
    for (let columnIndex = 1; columnIndex <= columns.length; columnIndex += 1) {
      current[columnIndex] = row === columns[columnIndex - 1]
        ? previous[columnIndex - 1]! + 1
        : Math.max(previous[columnIndex]!, current[columnIndex - 1]!);
    }
    previous.set(current);
    current.fill(0);
  }
  return previous[columns.length] ?? 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
