import type { Dirent } from 'node:fs';
import { createClaudeHistorySource, type ClaudeHistorySource, type ClaudeTurnRange } from './history-source';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Agent, BackendSession, ClaudeConversationTurn, ConversationSummary, RendererMessage, RendererMessagePart, RendererToolPart, ThreadGoal } from '@workspace/core/contracts';
import { claudeWorkingDirectory } from './working-directory';
import { claudeConfigDirectory } from './config-directory';
import { claudeToolPart, completedClaudeToolPart } from './claude-tool-part-adapter';
import { claudeToolResultText } from './claude-tool-result';
import { claudeMessageContentBlocks, parseClaudeSdkMessage, type ClaudeSdkContentBlock, type ClaudeSdkMessage } from './protocol';
import { claudeSubagentHistoryEvents } from './claude-subagents';
import { ClaudeTaskPlan } from './claude-task-plan';

export type ClaudeTranscriptHistory = {
  backendSession: BackendSession;
  messages: RendererMessage[];
  source?: ClaudeHistorySource;
  turns?: ClaudeConversationTurn[];
  turnBoundaries?: Record<string, string>;
  nativeMessageTurnIds?: Record<string, string>;
  goal?: ThreadGoal | null;
  subagentEvents?: import('@workspace/core/backend-driver').BackendEvent[];
  taskPlan?: ClaudeTaskPlan;
};

export type ClaudeTranscriptHistoryOptions = {
  projectsRoot?: string;
  subagentId?: string;
};

export type ClaudeTranscriptSettings = {
  model?: string;
  reasoningEffort?: string;
};

type TranscriptLine = ClaudeSdkMessage & {
  uuid?: string;
  promptId?: string;
  parentUuid?: string | null;
  timestamp?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isSidechain?: boolean;
  cwd?: string;
};

export async function loadClaudeTranscriptHistory(
  agent: Agent,
  options: ClaudeTranscriptHistoryOptions = {},
): Promise<ClaudeTranscriptHistory | null> {
  if (agent.backendSession?.kind !== 'claude') {
    return null;
  }

  const sessionId = agent.backendSession.transcriptSessionId ?? agent.backendSession.sessionId;
  if (!isSafeSessionId(sessionId)) {
    return null;
  }

  const projectsRoot = options.projectsRoot ?? path.join(claudeConfigDirectory(), 'projects');
  const transcriptPath = await findClaudeTranscriptPath(projectsRoot, agent.backendSession.transcriptFolder ?? claudeWorkingDirectory(agent), sessionId);
  if (!transcriptPath) {
    return {
      backendSession: agent.backendSession,
      messages: [],
    };
  }

  if (options.subagentId !== undefined) {
    if (typeof options.subagentId !== 'string' || !isSafeSessionId(options.subagentId)) throw new Error('Invalid Claude subagent reference.');
    const directory = path.join(path.dirname(transcriptPath), sessionId, 'subagents');
    const childPath = path.join(directory, `agent-${options.subagentId}.jsonl`);
    if (!await fileExists(childPath)) return { backendSession: agent.backendSession, messages: [] };
    const [project, child] = await Promise.all([realpath(path.dirname(transcriptPath)), realpath(childPath)]);
    if (!isPathInside(path.join(project, sessionId, 'subagents'), child)) throw new Error('Claude subagent transcript is outside its session.');
    const content = await readFile(child, 'utf8');
    return { backendSession: agent.backendSession,
      messages: claudeTranscriptToRendererMessages(content, agent.id, `${sessionId}-${options.subagentId}`, undefined, undefined, true),
    };
  }

  const content = await readFile(transcriptPath, 'utf8');
  const settings = claudeTranscriptSettings(content);
  const { model: _model, reasoningEffort: _reasoningEffort, ...session } = agent.backendSession;
  const turnBoundaries: Record<string, string> = {};
  const nativeMessageTurnIds: Record<string, string> = {};
  const goal = claudeTranscriptGoal(content, agent.backendSession.sessionId);
  const subagentEvents = claudeSubagentHistoryEvents(content, agent.id, agent.backendSession.sessionId);
  const taskPlan = new ClaudeTaskPlan();
  const turns: ClaudeConversationTurn[] = [];
  const ranges = new Map<string, ClaudeTurnRange>();
  const messages = claudeTranscriptToRendererMessages(content, agent.id, sessionId, turnBoundaries, nativeMessageTurnIds, false, taskPlan, turns, ranges);
  const source = await createClaudeHistorySource(transcriptPath, content, ranges,
    text => claudeTranscriptToRendererMessages(text, agent.id, sessionId));
  return {
    backendSession: {
      ...session,
      transcriptSessionId: sessionId,
      ...settings,
    },
    messages,
    source,
    turns,
    ...(taskPlan.plan ? { taskPlan } : {}),
    turnBoundaries,
    nativeMessageTurnIds,
    ...(subagentEvents.length ? { subagentEvents } : {}),
    ...(goal !== undefined ? { goal } : {}),
  };
}

// Claude Code 2.1.288 persists native /goal state here. SDK 0.3.226 does not
// deliver its exported active_goal message through the public query iterator.
export function claudeTranscriptGoal(content: string, sessionId: string): ThreadGoal | null | undefined {
  let goal: ThreadGoal | null | undefined;
  for (const line of content.split(/\r?\n/)) {
    const entry = parseClaudeSdkMessage(line) as Record<string, unknown> | null;
    if (!entry || entry.isSidechain || entry.type !== 'attachment') continue;
    const state = entry.attachment;
    if (!isRecord(state) || state.type !== 'goal_status' || typeof state.condition !== 'string' || typeof state.met !== 'boolean') continue;
    if (state.sentinel === true && state.met) { goal = null; continue; }
    const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) / 1000 : 0;
    const updatedAt = Number.isFinite(timestamp) ? timestamp : 0;
    goal = {
      threadId: sessionId, objective: state.condition, status: state.met ? 'complete' : 'active',
      tokenBudget: null,
      tokensUsed: typeof state.tokens === 'number' && Number.isFinite(state.tokens) ? Math.max(0, state.tokens) : 0,
      timeUsedSeconds: typeof state.durationMs === 'number' && Number.isFinite(state.durationMs) ? Math.max(0, state.durationMs / 1000) : 0,
      createdAt: state.sentinel || goal?.objective !== state.condition ? updatedAt : goal.createdAt,
      updatedAt,
    };
  }
  return goal;
}

export function claudeTranscriptSettings(content: string): ClaudeTranscriptSettings {
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  let assistantMessageId: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const entry = parseClaudeSdkMessage(line) as TranscriptLine | null;
    if (!entry || entry.type !== 'assistant' || entry.isSidechain || !isRecord(entry.message)) {
      continue;
    }

    const nextMessageId = typeof entry.message.id === 'string' ? entry.message.id : entry.uuid;
    if (nextMessageId && nextMessageId !== assistantMessageId) {
      reasoningEffort = undefined;
      assistantMessageId = nextMessageId;
    }

    if (typeof entry.message.model === 'string' && entry.message.model.trim()) {
      const nextModel = entry.message.model.trim();
      if (model && nextModel !== model) {
        reasoningEffort = undefined;
      }
      model = nextModel;
    }
    const effort = (entry as Record<string, unknown>).effort;
    if (typeof effort === 'string' && effort.trim()) {
      reasoningEffort = effort.trim();
    }
  }

  return {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export async function listClaudeTranscriptSummaries(
  agent: Agent,
  options: ClaudeTranscriptHistoryOptions = {},
): Promise<ConversationSummary[]> {
  const projectsRoot = options.projectsRoot ?? path.join(claudeConfigDirectory(), 'projects');
  const folder = agent.folder;
  const files: Array<{ filePath: string; sessionId: string; updatedAt: string; updatedAtMs: number }> = [];
  const seen = new Set<string>();

  for (const cwd of await claudeWorkspacePaths(claudeWorkingDirectory(agent))) {
    const projectDir = path.join(projectsRoot, claudeProjectDirectoryName(cwd));
    let entries: Dirent[];
    try {
      entries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = entry.name.slice(0, -'.jsonl'.length);
      if (!isSafeSessionId(sessionId) || seen.has(sessionId)) continue;

      const filePath = path.join(projectDir, entry.name);
      try {
        const fileStat = await stat(filePath);
        files.push({
          filePath,
          sessionId,
          updatedAt: fileStat.mtime.toISOString(),
          updatedAtMs: fileStat.mtimeMs,
        });
        seen.add(sessionId);
      } catch {
        continue;
      }
    }
  }

  files.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const summaries: ConversationSummary[] = [];
  for (const file of files.slice(0, 30)) {
    let content = '';
    try {
      content = await readFile(file.filePath, 'utf8');
    } catch {
      continue;
    }

    const transcriptSummary = summarizeClaudeTranscript(content);
    summaries.push({
      id: file.sessionId,
      title: transcriptSummary.title,
      updatedAt: file.updatedAt,
      messageCount: transcriptSummary.messageCount,
      storageState: 'active',
      ref: {
        backend: 'claude',
        folder,
        sessionId: file.sessionId,
      },
    });
  }

  return summaries;
}

export function claudeTranscriptToRendererMessages(content: string, agentId: string, sessionId: string, turnBoundaries?: Record<string, string>, nativeMessageTurnIds?: Record<string, string>, includeSidechain = false, taskPlan?: ClaudeTaskPlan, turns?: ClaudeConversationTurn[], ranges?: Map<string, ClaudeTurnRange>): RendererMessage[] {
  const messages: RendererMessage[] = [];
  let currentTurnId: string | null = null;
  let currentTurnCreatedAt: string | null = null;
  let currentTurn: ClaudeConversationTurn | null = null;
  let assistantCreatedAt: string | null = null;
  const assistantSegments = new Map<string, number>();
  const turnsById = new Map<string, ClaudeConversationTurn>();
  const assistantParts: RendererMessagePart[] = [];
  const pendingTools = new Set<string>();
  let byteOffset = 0; let lineStart = 0; let lineEnd = 0;
  const rememberRange = () => {
    if (!ranges || !currentTurnId) return;
    const previous = ranges.get(currentTurnId);
    ranges.set(currentTurnId, { start: previous?.start ?? lineStart, end: lineEnd });
  };
  const rememberBoundary = (entry: TranscriptLine) => {
    rememberRange();
    if (!currentTurnId || !entry.uuid) return;
    if (nativeMessageTurnIds) nativeMessageTurnIds[entry.uuid] = currentTurnId;
    if (!turnBoundaries) return;
    if (pendingTools.size) delete turnBoundaries[currentTurnId];
    else turnBoundaries[currentTurnId] = entry.uuid;
  };

  const flushAssistantMessage = () => {
    if (!currentTurnId || assistantParts.length === 0) {
      return;
    }

    const segmentIndex = assistantSegments.get(currentTurnId) ?? 0;
    const segmentSuffix = segmentIndex === 0 ? '' : `-segment-${segmentIndex}`;
    messages.push({
      id: `assistant-${currentTurnId}${segmentSuffix}`,
      agentId,
      role: 'assistant',
      status: 'complete',
      turnId: currentTurnId,
      createdAt: assistantCreatedAt ?? currentTurnCreatedAt ?? new Date(0).toISOString(),
      parts: [...assistantParts],
    });
    assistantParts.length = 0;
    assistantCreatedAt = null;
    assistantSegments.set(currentTurnId, segmentIndex + 1);
  };

  const contentBytes = ranges ? Buffer.byteLength(content) : 0;
  for (const line of content.split('\n')) {
    if (ranges) { lineStart = byteOffset; byteOffset += Buffer.byteLength(line) + 1; lineEnd = Math.min(byteOffset, contentBytes); }
    const entry = parseClaudeSdkMessage(line) as TranscriptLine | null;
    if (!entry || entry.isSidechain && !includeSidechain) {
      continue;
    }

    if (entry.type === 'user') {
      const toolResults = claudeMessageContentBlocks(entry).filter(isClaudeToolResultBlock);
      if (toolResults.length > 0) {
        for (const toolResult of toolResults) {
          pendingTools.delete(toolResult.tool_use_id);
          const completed = applyToolResult(assistantParts, toolResult);
          if (completed && currentTurnId) taskPlan?.apply(completed,
            entry.toolUseResult ?? entry.tool_use_result ?? toolResult.content,
            sessionId, currentTurnId, timestampToIso(entry.timestamp));
        }
        rememberBoundary(entry);
        continue;
      }

      // Compaction context continues the same prompt; it is not another user turn.
      if (entry.isMeta || entry.isCompactSummary) {
        continue;
      }

      const text = messageText(entry);
      if (!text) {
        continue;
      }

      flushAssistantMessage();
      currentTurnId = claudeTurnId(entry, sessionId, messages.length);
      rememberRange();
      if (nativeMessageTurnIds && entry.uuid) nativeMessageTurnIds[entry.uuid] = currentTurnId;
      currentTurnCreatedAt = timestampToIso(entry.timestamp);
      const existingTurn = turnsById.get(currentTurnId);
      currentTurn = existingTurn ?? {
        id: currentTurnId, status: 'completed', error: null, willRetry: false,
        startedAt: typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp)) ? currentTurnCreatedAt : null,
        completedAt: null, durationMs: null,
      };
      if (!existingTurn) {
        turnsById.set(currentTurnId, currentTurn);
        turns?.push(currentTurn);
        taskPlan?.startTurn(currentTurnId);
      }
      messages.push({
        id: `user-${sessionId}-${entry.uuid ?? messages.length}`,
        agentId,
        role: 'user',
        ...(existingTurn ? { kind: 'steer' as const } : {}),
        status: 'complete',
        turnId: currentTurnId,
        createdAt: currentTurnCreatedAt,
        parts: [{ type: 'text', text }],
      });
      continue;
    }

    if (entry.type === 'assistant') {
      const parts = assistantMessageParts(entry, entry.cwd);
      if (parts.length === 0) {
        continue;
      }

      if (!currentTurnId) {
        currentTurnId = claudeTurnId(entry, sessionId, messages.length);
        currentTurnCreatedAt = timestampToIso(entry.timestamp);
      }
      assistantCreatedAt ??= timestampToIso(entry.timestamp);
      if (currentTurn) {
        currentTurn.completedAt = typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp)) ? timestampToIso(entry.timestamp) : null;
        const durationMs = currentTurn.startedAt && currentTurn.completedAt
          ? Date.parse(currentTurn.completedAt) - Date.parse(currentTurn.startedAt) : NaN;
        currentTurn.durationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
      }
      for (const block of claudeMessageContentBlocks(entry)) {
        if (block.type === 'tool_use' && typeof block.id === 'string') pendingTools.add(block.id);
      }
      rememberBoundary(entry);
      assistantParts.push(...parts);
      continue;
    }

    // Native goal/evaluator attachments belong to the completed turn's chain.
    if (entry.type === 'attachment' && currentTurnId && turnBoundaries?.[currentTurnId]) rememberBoundary(entry);

    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      rememberRange();
      flushAssistantMessage();
      const turnId = `claude-compact-${entry.uuid ?? messages.length}`;
      messages.push({
        id: `compaction-${turnId}`,
        agentId,
        kind: 'compaction',
        role: 'assistant',
        status: 'complete',
        turnId: currentTurnId ?? turnId,
        createdAt: timestampToIso(entry.timestamp),
        parts: [],
      });
    }
  }

  flushAssistantMessage();
  return messages;
}

function summarizeClaudeTranscript(content: string): { title: string; messageCount: number } {
  let title = '';
  let messageCount = 0;

  for (const line of content.split(/\r?\n/)) {
    const entry = parseClaudeSdkMessage(line) as TranscriptLine | null;
    if (!entry || entry.isSidechain) {
      continue;
    }

    if (entry.type === 'user') {
      if (entry.isMeta || claudeMessageContentBlocks(entry).some(isClaudeToolResultBlock)) {
        continue;
      }

      const text = messageText(entry);
      if (!text) {
        continue;
      }

      messageCount += 1;
      title ||= compactTitle(claudeTitleText(text));
      continue;
    }

    if (entry.type === 'assistant' && assistantMessageParts(entry).length > 0) {
      messageCount += 1;
    }
  }

  return {
    title: title || 'Untitled conversation',
    messageCount,
  };
}

function claudeTitleText(text: string): string {
  const commandName = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
  if (!commandName) {
    return text;
  }

  const commandArgs = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return commandArgs ? `/${commandName} ${commandArgs}` : `/${commandName}`;
}

function compactTitle(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > 96 ? `${compacted.slice(0, 93)}...` : compacted;
}

async function findClaudeTranscriptPath(projectsRoot: string, folder: string, sessionId: string): Promise<string | null> {
  const folders = await claudeWorkspacePaths(folder);
  for (const cwd of folders) {
    const directPath = path.join(projectsRoot, claudeProjectDirectoryName(cwd), `${sessionId}.jsonl`);
    if (await fileExists(directPath)) return directPath;
  }

  for (const cwd of folders) {
    const indexedPath = await findIndexedTranscriptPath(projectsRoot, cwd, sessionId);
    if (indexedPath && await fileExists(indexedPath)) return indexedPath;
  }
  return null;
}

async function claudeWorkspacePaths(folder: string): Promise<string[]> {
  const expanded = expandHome(folder);
  try {
    // Claude canonicalizes cwd (for example /tmp becomes /private/tmp on macOS).
    const canonical = await realpath(expanded);
    return canonical === expanded ? [expanded] : [expanded, canonical];
  } catch {
    // History remains readable even after the original workspace is removed.
    return [expanded];
  }
}

async function findIndexedTranscriptPath(projectsRoot: string, folder: string, sessionId: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(projectsRoot);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const indexPath = path.join(projectsRoot, entry, 'sessions-index.json');
    let rawIndex: string;
    try {
      rawIndex = await readFile(indexPath, 'utf8');
    } catch {
      continue;
    }

    const parsed = safeJson(rawIndex);
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
      continue;
    }

    for (const sessionEntry of parsed.entries) {
      if (
        !isRecord(sessionEntry) ||
        sessionEntry.sessionId !== sessionId ||
        sessionEntry.projectPath !== folder ||
        typeof sessionEntry.fullPath !== 'string'
      ) {
        continue;
      }

      const resolved = path.resolve(sessionEntry.fullPath);
      if (isPathInside(path.resolve(projectsRoot), resolved)) {
        return resolved;
      }
    }
  }

  return null;
}

function assistantMessageParts(message: ClaudeSdkMessage, cwd?: string): RendererMessagePart[] {
  return claudeMessageContentBlocks(message).flatMap((block): RendererMessagePart[] => {
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      return [{ type: 'text', text: block.text }];
    }

    if (isClaudeToolUseBlock(block)) {
      return [claudeToolPart(block, { cwd })];
    }

    return [];
  });
}

function messageText(message: ClaudeSdkMessage): string {
  return claudeMessageContentBlocks(message)
    .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function applyToolResult(parts: RendererMessagePart[], block: Extract<ClaudeSdkContentBlock, { type: 'tool_result' }>): RendererToolPart | undefined {
  const toolPart = parts.find((part): part is RendererToolPart => part.type === 'tool' && part.id === block.tool_use_id);
  if (!toolPart) {
    return;
  }

  Object.assign(
    toolPart,
    completedClaudeToolPart(
      toolPart,
      block.is_error ? 'failed' : 'completed',
      block.content,
      claudeToolResultText(block.content),
    ),
  );
  return toolPart;
}

function claudeTurnId(entry: TranscriptLine, sessionId: string, index: number): string {
  return `claude-${entry.promptId ?? entry.uuid ?? `${sessionId}-${index}`}`;
}

function claudeProjectDirectoryName(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, '-');
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function timestampToIso(value: string | undefined): string {
  if (!value) {
    return new Date(0).toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !value.includes('..');
}

function isClaudeToolUseBlock(block: ClaudeSdkContentBlock): block is Extract<ClaudeSdkContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';
}

function isClaudeToolResultBlock(block: ClaudeSdkContentBlock): block is Extract<ClaudeSdkContentBlock, { type: 'tool_result' }> {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string';
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
