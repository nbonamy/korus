import type { CodexChatMessage } from '@codex-app-sdk/vue';
import type { RendererMessage } from '@workspace/core/contracts';
import { parseCollaborationMessageEnvelope } from '@workspace/core/collaboration-message-envelope';
import { product } from '@workspace/core/product';

export type CollaborationMessagePresentation = {
  content: string;
  messageCount: number;
  senderNames: string[];
};

export function presentCollaborationMessage(message: CodexChatMessage): {
  message: CodexChatMessage;
  presentation: CollaborationMessagePresentation | null;
} {
  const presentation = message.role === 'user'
    ? parseCollaborationMessage(message.content)
    : null;
  if (!presentation) return { message, presentation: null };

  return {
    message: {
      ...message,
      content: presentation.content,
      parts: [
        { type: 'text', content: presentation.content },
        ...(message.parts?.filter((part) => part.type !== 'text') ?? []),
      ],
    },
    presentation,
  };
}

export function presentRendererCollaborationMessage(message: RendererMessage): {
  message: RendererMessage;
  presentation: CollaborationMessagePresentation | null;
} {
  if (message.role !== 'user') return { message, presentation: null };
  const content = message.parts
    .filter((part): part is Extract<RendererMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
  const presentation = parseCollaborationMessage(content);
  if (!presentation) return { message, presentation: null };

  return {
    message: {
      ...message,
      parts: [
        { type: 'text', text: presentation.content },
        ...message.parts.filter((part) => part.type !== 'text'),
      ],
    },
    presentation,
  };
}

export function parseCollaborationMessage(content: string): CollaborationMessagePresentation | null {
  const envelope = parseCollaborationMessageEnvelope(content);
  if (envelope) {
    return presentationFromMessages(envelope.messages.map((message) => ({
      senderName: message.senderName.trim(),
      content: message.content.trim(),
    })));
  }
  return parseLegacySingleMessage(content) ?? parseLegacyMultipleMessages(content);
}

function parseLegacySingleMessage(content: string): CollaborationMessagePresentation | null {
  const body = legacyEnvelopeBody(content);
  if (!body) return null;
  const match = /^You received a message from (.+) \(([^)\n]+)\)\.\r?\n\r?\nMessage:\r?\n([\s\S]*)$/.exec(body);
  if (!match) return null;

  const senderName = match[1]?.trim();
  const messageContent = match[3]?.trim();
  if (!senderName || !messageContent) return null;

  return {
    content: messageContent,
    messageCount: 1,
    senderNames: [senderName],
  };
}

function parseLegacyMultipleMessages(content: string): CollaborationMessagePresentation | null {
  const body = legacyEnvelopeBody(content);
  if (!body) return null;
  const productName = product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^You received (\\d+) messages from other ${productName} agents\\.\\r?\\n\\r?\\n`).exec(body);
  if (!heading) return null;

  const expectedCount = Number(heading[1]);
  const entries = body.slice(heading[0].length).split(/\r?\n\r?\n(?=Message \d+ from )/);
  const parsed = entries.map((entry) => {
    const match = /^Message (\d+) from (.+) \(([^)\n]+)\) at ([^\n]+):\r?\n([\s\S]*)$/.exec(entry);
    const senderName = match?.[2]?.trim();
    const messageContent = match?.[5]?.trim();
    return senderName && messageContent ? { senderName, content: messageContent } : null;
  });
  if (parsed.length !== expectedCount || parsed.some((entry) => entry === null)) return null;

  const messages = parsed.filter((entry): entry is { senderName: string; content: string } => entry !== null);
  return presentationFromMessages(messages);
}

function presentationFromMessages(
  messages: Array<{ senderName: string; content: string }>,
): CollaborationMessagePresentation {
  const senderNames = [...new Set(messages.map((entry) => entry.senderName))];
  return {
    content: senderNames.length === 1
      ? messages.map((entry) => entry.content).join('\n\n')
      : messages.map((entry) => `${entry.senderName}:\n${entry.content}`).join('\n\n'),
    messageCount: messages.length,
    senderNames,
  };
}

function legacyEnvelopeBody(content: string): string | null {
  const instructions = /\r?\n\r?\n(?=(?:Act on (?:this|these) teammate messages?\b|Update your status\b))/.exec(content);
  return instructions ? content.slice(0, instructions.index) : null;
}
