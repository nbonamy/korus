import { normalizePromptContent, promptContentText, type CodexPromptPart } from '@codex-app-sdk/core/surface';
import type {
  ClaudeConversationSnapshot,
  PromptAttachment,
  RendererMessage,
  RendererMessagePart,
} from './contracts';

type ClaudeTranscriptState = Pick<ClaudeConversationSnapshot, 'messages'> & Partial<Pick<ClaudeConversationSnapshot, 'turns'>>;

export function appendSystemMessage(snapshot: ClaudeTranscriptState, agentId: string, text: string, createdAt = new Date().toISOString()): RendererMessage {
  const message: RendererMessage = {
    id: `system-${createdAt.replace(/\W/g, '').toLowerCase()}`,
    agentId,
    role: 'system',
    status: 'error',
    createdAt,
    parts: [{ type: 'status', text }],
  };

  snapshot.messages.push(message);
  pruneSupersededEmptyAssistantPlaceholders(snapshot, agentId);

  return message;
}

export function appendAssistantDelta(
  snapshot: ClaudeTranscriptState,
  agentId: string,
  turnId: string,
  delta: string,
  createdAt: string,
  itemId?: string,
  phase?: Extract<RendererMessagePart, { type: 'text' }>['phase'],
): void {
  const message = ensureAssistantMessage(snapshot, agentId, turnId, assistantMessageId(turnId), createdAt);
  if (message.status !== 'complete') {
    message.status = 'streaming';
  }

  const textPart = message.parts.at(-1);
  if (textPart?.type === 'text' && textPart.itemId === itemId) {
    textPart.text += delta;
    if (phase) textPart.phase = phase;
  } else {
    message.parts.push({
      type: 'text',
      text: delta,
      ...(itemId ? { itemId } : {}),
      ...(phase ? { phase } : {}),
    });
  }
  pruneSupersededEmptyAssistantPlaceholders(snapshot, agentId);
}

export function appendCompactionMarker(snapshot: ClaudeTranscriptState, agentId: string, turnId: string, createdAt: string): RendererMessage {
  const existing = snapshot.messages.find((message) => {
    return message.agentId === agentId && message.id === compactionMessageId(turnId);
  });
  if (existing) {
    return existing;
  }

  const activeAssistantMessage = findAssistantMessage(snapshot, agentId, turnId);
  if (activeAssistantMessage?.parts.length === 0 && activeAssistantMessage.id === assistantMessageId(turnId)) {
    snapshot.messages = snapshot.messages.filter((message) => message !== activeAssistantMessage);
  } else if (activeAssistantMessage) {
    activeAssistantMessage.status = 'complete';
  }

  const message: RendererMessage = {
    id: compactionMessageId(turnId),
    agentId,
    kind: 'compaction',
    role: 'assistant',
    status: 'streaming',
    turnId,
    createdAt,
    parts: [],
  };
  snapshot.messages.push(message);
  pruneSupersededEmptyAssistantPlaceholders(snapshot, agentId);

  return message;
}

export function ensureAssistantMessage(
  snapshot: ClaudeTranscriptState,
  agentId: string,
  turnId: string,
  messageId: string,
  createdAt: string,
): RendererMessage {
  let effectiveMessageId = messageId;
  let effectiveCreatedAt = createdAt;
  const boundaryMessage = messageId === assistantMessageId(turnId)
    ? findAssistantSegmentBoundary(snapshot, agentId, turnId)
    : undefined;
  const message = messageId === assistantMessageId(turnId)
    ? findAssistantMessageForAppend(snapshot, agentId, turnId)
    : snapshot.messages.find((candidate) => candidate.id === messageId && candidate.agentId === agentId);

  if (message) {
    return message;
  }
  if (boundaryMessage) {
    effectiveMessageId = boundaryMessage.kind === 'steer'
      ? `${assistantMessageId(turnId)}-segment-${boundaryMessage.id}`
      : assistantSegmentMessageId(turnId, boundaryMessage.createdAt);
    effectiveCreatedAt = boundaryMessage.createdAt;
  }

  const nextMessage: RendererMessage = {
    id: effectiveMessageId,
    agentId,
    role: 'assistant',
    status: 'streaming',
    turnId,
    createdAt: effectiveCreatedAt,
    parts: [],
  };
  snapshot.messages.push(nextMessage);
  return nextMessage;
}

export function completeAssistantMessage(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): void {
  for (const message of findAssistantMessages(snapshot, agentId, turnId)) {
    message.status = 'complete';
  }
  for (const message of findCompactionMessages(snapshot, agentId, turnId)) {
    message.status = 'complete';
  }

  snapshot.messages = snapshot.messages.filter((message) => (
    message.agentId !== agentId ||
    !isAssistantTurnMessage(message, agentId, turnId) ||
    message.parts.length > 0
  ));
  pruneSupersededEmptyAssistantPlaceholders(snapshot, agentId);
}

export function pruneSupersededEmptyAssistantPlaceholders(snapshot: ClaudeTranscriptState, agentId: string): void {
  let lastAgentMessageIndex = -1;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    if (snapshot.messages[index]?.agentId === agentId) {
      lastAgentMessageIndex = index;
      break;
    }
  }

  if (lastAgentMessageIndex === -1) {
    return;
  }

  for (let index = lastAgentMessageIndex - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.agentId === agentId && isPlainEmptyAssistantPlaceholder(message)
      && !snapshot.turns?.some(turn => turn.id === message.turnId && turn.itemsView === 'summary')) {
      snapshot.messages.splice(index, 1);
    }
  }
}

function isPlainEmptyAssistantPlaceholder(message: RendererMessage): boolean {
  return message.role === 'assistant' && message.kind === undefined && message.parts.length === 0;
}

function findAssistantMessageForAppend(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): RendererMessage | undefined {
  const boundaryMessage = findAssistantSegmentBoundary(snapshot, agentId, turnId);
  if (!boundaryMessage) {
    return findAssistantMessage(snapshot, agentId, turnId);
  }

  const compactionIndex = snapshot.messages.indexOf(boundaryMessage);
  return snapshot.messages
    .slice(compactionIndex + 1)
    .filter((message) => isAssistantTurnMessage(message, agentId, turnId))
    .at(-1);
}

function findAssistantSegmentBoundary(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): RendererMessage | undefined {
  return snapshot.messages.filter((message) => message.agentId === agentId && message.turnId === turnId
    && (message.kind === 'compaction' || message.kind === 'steer')).at(-1);
}

export function findAssistantMessage(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): RendererMessage | undefined {
  return findAssistantMessages(snapshot, agentId, turnId).at(-1);
}

export function findAssistantMessages(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): RendererMessage[] {
  return snapshot.messages.filter((message) => isAssistantTurnMessage(message, agentId, turnId));
}

function isAssistantTurnMessage(message: RendererMessage, agentId: string, turnId: string): boolean {
  const baseId = assistantMessageId(turnId);
  return (
    message.agentId === agentId &&
    message.role === 'assistant' &&
    (message.id === baseId || message.id.startsWith(`${baseId}-segment-`))
  );
}

export function findCompactionMessages(snapshot: ClaudeTranscriptState, agentId: string, turnId: string): RendererMessage[] {
  return snapshot.messages.filter((message) => (
    message.agentId === agentId &&
    message.kind === 'compaction' &&
    message.turnId === turnId
  ));
}

export function findAssistantMessageWithToolPart(snapshot: ClaudeTranscriptState, agentId: string, turnId: string, itemId: string): RendererMessage | undefined {
  return findAssistantMessages(snapshot, agentId, turnId).find((message) => (
    message.parts.some((part) => part.type === 'tool' && part.id === itemId)
  ));
}

export function assistantMessageId(turnId: string): string {
  return `assistant-${turnId}`;
}

function assistantSegmentMessageId(turnId: string, createdAt: string): string {
  return `${assistantMessageId(turnId)}-segment-${createdAt.replace(/\W/g, '').toLowerCase()}`;
}

function compactionMessageId(turnId: string): string {
  return `compaction-${turnId}`;
}

export function createUserMessage(
  agentId: string,
  prompt: string,
  createdAt: string,
  idPrefix = 'message',
  turnId?: string,
  attachments: readonly PromptAttachment[] = [],
  content?: readonly CodexPromptPart[],
): RendererMessage {
  const isSteer = idPrefix.startsWith('steer-');
  return {
    id: `${idPrefix}-${createdAt.replace(/\W/g, '').toLowerCase()}`,
    agentId,
    ...(isSteer ? { kind: 'steer' as const } : {}),
    role: 'user',
    ...(content === undefined ? {} : { metadata: { promptContent: normalizePromptContent(content) } }),
    status: 'complete',
    ...(turnId ? { turnId } : {}),
    createdAt,
    parts: [
      { type: 'text', text: content === undefined ? prompt : promptContentText(content) },
      ...attachments.map(promptAttachmentPart),
    ],
  };
}

function promptAttachmentPart(attachment: PromptAttachment): RendererMessagePart {
  const name = attachment.name?.trim() || attachmentFileName(attachment.path) || (
    attachment.type === 'image' ? 'Image' : 'File'
  );
  return {
    type: 'attachment',
    attachment: {
      kind: attachment.type,
      name,
      path: attachment.path,
      ...('mimeType' in attachment && attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.type === 'image' && attachment.previewUrl ? { url: attachment.previewUrl } : {}),
    },
  };
}

function attachmentFileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1)?.trim() ?? '';
}
