import { describe, expect, it } from 'vitest';
import type {
  Agent,
  ClaudeConversationSnapshot,
  MainToRendererEvent,
  RendererMessage,
  RendererToolPart,
} from '../contracts';
import { conversationRefFromAgent } from '../conversation-ref';
import { providerConversationEventView } from '../provider-conversation-event';
import { isRendererMessage } from '../snapshot-guard-collections';
import { isRecord, parseJsonPreview, stringValue } from '../claude-conversation-payloads';
import {
  appendAgentPlanMarkdownDelta,
  appendAssistantDeltaWithPlanFilter,
  planProgressOperation,
  updateAgentPlanMarkdown,
  upsertPlanProgressToolPart,
} from '../claude-conversation-plans';
import { applyClaudeConversationEvent } from '../claude-conversation-reducer';
import {
  applyApprovalRequest,
  applyToolInputRequest,
  updateAssistantToolPart,
  upsertAssistantToolPart,
} from '../claude-conversation-tools';
import {
  appendAssistantDelta,
  appendCompactionMarker,
  appendSystemMessage,
  assistantMessageId,
  completeAssistantMessage,
  createUserMessage,
  ensureAssistantMessage,
  findAssistantMessage,
  findAssistantMessages,
  findAssistantMessageWithToolPart,
  findCompactionMessages,
  pruneSupersededEmptyAssistantPlaceholders,
} from '../claude-conversation-transcript';

const createdAt = '2026-09-06T00:00:01.000Z';

describe('Claude conversation payload helpers', () => {
  it('narrows records and optional strings', () => {
    expect(isRecord({ key: 'value' })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(stringValue('value')).toBe('value');
    expect(stringValue(42)).toBeUndefined();
  });

  it('parses only valid JSON previews', () => {
    expect(parseJsonPreview(' {"command":"npm test"} ')).toStrictEqual({ command: 'npm test' });
    expect(parseJsonPreview('[1, 2]')).toStrictEqual([1, 2]);
    expect(parseJsonPreview('npm test')).toBeUndefined();
    expect(parseJsonPreview('{broken')).toBeUndefined();
  });
});

describe('provider conversation boundaries', () => {
  it('derives Codex and Claude references from provider sessions', () => {
    expect(conversationRefFromAgent(agent({ kind: 'codex', threadId: 'thread-1' }))).toStrictEqual({
      backend: 'codex', threadId: 'thread-1',
    });
    expect(conversationRefFromAgent(agent({
      kind: 'claude', sessionId: 'session-live', transcriptSessionId: 'session-history', transport: 'stdio',
    }))).toStrictEqual({ backend: 'claude', folder: '/repo', sessionId: 'session-history' });
    expect(conversationRefFromAgent(agent({ kind: 'claude', sessionId: 'session-live', transport: 'stdio' }))).toStrictEqual({
      backend: 'claude', folder: '/repo', sessionId: 'session-live',
    });
    expect(conversationRefFromAgent(agent({ kind: 'claude', sessionId: 'native-child', transport: 'stdio', transcriptFolder: '/source-store' }))).toStrictEqual({
      backend: 'claude', folder: '/source-store', sessionId: 'native-child',
    });
    expect(conversationRefFromAgent(agent())).toBeNull();
    expect(conversationRefFromAgent(agent({ kind: 'antigravity', sessionId: 'acp-session' }))).toStrictEqual({
      backend: 'antigravity', folder: '/repo', sessionId: 'acp-session',
    });
    expect(conversationRefFromAgent({
      ...agent({ kind: 'claude', sessionId: 'session-live', transport: 'stdio' }), folder: null,
    })).toStrictEqual({ backend: 'claude', folder: null, sessionId: 'session-live' });
  });

  it('unwraps provider frames and preserves ordinary app-owned events', () => {
    const providerEvent = {
      seq: 1,
      occurredAt: createdAt,
      agentId: 'agent-1',
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 2,
        event: {
          seq: 2,
          occurredAt: createdAt,
          agentId: 'agent-1',
          backend: 'claude',
          turnId: 'turn-1',
          type: 'error',
          payload: { message: 'failed' },
        },
      },
    } satisfies MainToRendererEvent;
    expect(providerConversationEventView(providerEvent)).toStrictEqual({
      type: 'error', agentId: 'agent-1', turnId: 'turn-1', payload: { message: 'failed' },
    });
    expect(providerConversationEventView({
      ...providerEvent,
      payload: { ...providerEvent.payload, event: { ...providerEvent.payload.event, turnId: undefined } },
    } as MainToRendererEvent)).toStrictEqual({
      type: 'error', agentId: 'agent-1', payload: { message: 'failed' },
    });
    expect(providerConversationEventView({
      seq: 3, occurredAt: createdAt, backend: 'claude', type: 'backend.statusChanged', payload: { backend: 'claude', status: 'running' },
    })).toStrictEqual({ type: 'backend.statusChanged', payload: { backend: 'claude', status: 'running' } });
    expect(providerConversationEventView({
      seq: 4,
      occurredAt: createdAt,
      agentId: 'agent-1',
      backend: 'claude',
      threadId: 'session-1',
      turnId: 'turn-1',
      type: 'client.markdownDisplayRequested',
      payload: { kind: 'markdown', content: '# Plan' },
    })).toStrictEqual({
      type: 'client.markdownDisplayRequested', agentId: 'agent-1', conversationId: 'session-1', turnId: 'turn-1', payload: { kind: 'markdown', content: '# Plan' },
    });
  });

  it('produces transcript messages accepted by the app-owned renderer contract', () => {
    expect(isRendererMessage({
      id: 'assistant-1',
      agentId: 'agent-1',
      role: 'assistant',
      status: 'complete',
      turnId: 'turn-1',
      createdAt,
      parts: [
        { type: 'attachment', attachment: { kind: 'image', name: 'image.png', path: '/tmp/image.png', url: 'blob:image', mimeType: 'image/png' } },
        { type: 'media', itemId: 'media-1', media: { url: 'https://example.com/image.png', alt: 'Preview', mimeType: 'image/png', prompt: 'Draw it', title: 'Image' } },
        { type: 'reasoning', itemId: 'reasoning-1', summaryIndex: 0, summary: 'Thinking' },
        { type: 'text', itemId: 'text-1', phase: 'final_answer', text: 'Done' },
        { type: 'tool', id: 'tool-1', kind: 'command', title: 'Test', status: 'completed', statusText: 'done', body: 'pass', metadata: { command: 'npm test' } },
        { type: 'status', text: 'Complete' },
      ],
    })).toBe(true);
    expect(isRendererMessage({
      id: 'assistant-1', agentId: 'agent-1', role: 'assistant', status: 'complete', createdAt,
      parts: [{ type: 'unknown' }],
    })).toBe(false);
    expect(isRendererMessage({
      id: 'assistant-1', agentId: 'agent-1', role: 'assistant', status: 'complete', createdAt,
      parts: [{ type: 'media', media: {} }],
    })).toBe(false);
    expect(isRendererMessage({
      id: 'assistant-1', agentId: 'agent-1', role: 'assistant', status: 'complete', createdAt,
      parts: [null],
    })).toBe(false);
  });
});

describe('Claude conversation transcript helpers', () => {
  it('streams adjacent deltas together and separates different items and phases', () => {
    const snapshot = emptySnapshot();
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', 'Hello', createdAt, 'item-1', 'commentary');
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', ' world', createdAt, 'item-1', 'final_answer');
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', 'Next', createdAt, 'item-2');

    expect(snapshot.messages).toStrictEqual([expect.objectContaining({
      id: 'assistant-turn-1',
      status: 'streaming',
      parts: [
        { type: 'text', text: 'Hello world', itemId: 'item-1', phase: 'final_answer' },
        { type: 'text', text: 'Next', itemId: 'item-2' },
      ],
    })]);
    snapshot.messages[0]!.status = 'complete';
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', '!', createdAt, 'item-2');
    expect(snapshot.messages[0]?.status).toBe('complete');
  });

  it('creates, reuses, finds, and completes assistant messages', () => {
    const snapshot = emptySnapshot();
    const first = ensureAssistantMessage(snapshot, 'agent-1', 'turn-1', assistantMessageId('turn-1'), createdAt);
    expect(ensureAssistantMessage(snapshot, 'agent-1', 'turn-1', assistantMessageId('turn-1'), createdAt)).toBe(first);
    const explicit = ensureAssistantMessage(snapshot, 'agent-1', 'turn-2', 'custom-message', createdAt);
    expect(ensureAssistantMessage(snapshot, 'agent-1', 'turn-2', 'custom-message', createdAt)).toBe(explicit);
    explicit.parts.push({ type: 'text', text: 'kept' });

    expect(findAssistantMessage(snapshot, 'agent-1', 'turn-2')).toBeUndefined();
    expect(findAssistantMessages(snapshot, 'agent-1', 'turn-1')).toStrictEqual([first]);
    completeAssistantMessage(snapshot, 'agent-1', 'turn-1');
    expect(snapshot.messages).toStrictEqual([explicit]);
  });

  it('segments assistant output around compaction and completes every segment', () => {
    const snapshot = emptySnapshot();
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', 'Before', createdAt);
    const marker = appendCompactionMarker(snapshot, 'agent-1', 'turn-1', '2026-09-06T00:00:02.000Z');
    expect(appendCompactionMarker(snapshot, 'agent-1', 'turn-1', createdAt)).toBe(marker);
    appendAssistantDelta(snapshot, 'agent-1', 'turn-1', 'After', '2026-09-06T00:00:03.000Z');

    expect(findCompactionMessages(snapshot, 'agent-1', 'turn-1')).toStrictEqual([marker]);
    expect(findAssistantMessages(snapshot, 'agent-1', 'turn-1').map((message) => message.id)).toStrictEqual([
      'assistant-turn-1',
      'assistant-turn-1-segment-20260906t000002000z',
    ]);
    snapshot.messages.push({ ...user('other-turn', 'Other'), turnId: 'turn-2' });
    ensureAssistantMessage(snapshot, 'agent-1', 'turn-1', assistantMessageId('turn-1'), '2026-09-06T00:00:04.000Z');
    completeAssistantMessage(snapshot, 'agent-1', 'turn-1');
    expect(snapshot.messages.every((message) => message.status === 'complete')).toBe(true);
  });

  it('replaces an empty assistant placeholder with the compaction marker', () => {
    const snapshot = emptySnapshot();
    ensureAssistantMessage(snapshot, 'agent-1', 'turn-1', assistantMessageId('turn-1'), createdAt);
    appendCompactionMarker(snapshot, 'agent-1', 'turn-1', createdAt);
    expect(snapshot.messages.map((message) => message.id)).toStrictEqual(['compaction-turn-1']);
  });

  it('prunes superseded empty placeholders but keeps the latest and other agents', () => {
    const snapshot = emptySnapshot();
    snapshot.messages = [
      assistant('old-empty', 'turn-old'),
      { ...assistant('other-empty', 'turn-old'), agentId: 'agent-2' },
      user('user-1', 'latest'),
      assistant('latest-empty', 'turn-new'),
    ];
    pruneSupersededEmptyAssistantPlaceholders(snapshot, 'missing-agent');
    pruneSupersededEmptyAssistantPlaceholders(snapshot, 'agent-1');
    expect(snapshot.messages.map((message) => message.id)).toStrictEqual([
      'other-empty', 'user-1', 'latest-empty',
    ]);
  });

  it('adds system errors and user messages with normalized attachments', () => {
    const snapshot = emptySnapshot();
    snapshot.messages.push(assistant('stale-empty', 'turn-old'));
    const system = appendSystemMessage(snapshot, 'agent-1', 'Disconnected', createdAt);
    expect(system).toMatchObject({ role: 'system', status: 'error', parts: [{ type: 'status', text: 'Disconnected' }] });
    expect(snapshot.messages).toStrictEqual([system]);

    expect(createUserMessage('agent-1', 'Continue', createdAt, 'steer-prompt', 'turn-1', [
      { type: 'file', path: 'C:\\repo\\notes.txt' },
      { type: 'image', path: '/tmp/image.png', name: ' ', mimeType: 'image/png', previewUrl: 'blob:image' },
      { type: 'image', path: '', name: '' },
    ])).toMatchObject({
      kind: 'steer',
      turnId: 'turn-1',
      parts: [
        { type: 'text', text: 'Continue' },
        { type: 'attachment', attachment: { kind: 'file', name: 'notes.txt', path: 'C:\\repo\\notes.txt' } },
        { type: 'attachment', attachment: { kind: 'image', name: 'image.png', mimeType: 'image/png', url: 'blob:image' } },
        { type: 'attachment', attachment: { kind: 'image', name: 'Image' } },
      ],
    });
  });
});

describe('Claude conversation tool helpers', () => {
  it('updates every mutable tool field and merges metadata', () => {
    const snapshot = emptySnapshot();
    const tool = runningTool('tool-1');
    tool.body = 'before';
    tool.metadata = { server: 'old', keep: true };
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', tool, createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', {
      itemId: 'tool-1',
      title: 'Updated',
      status: 'completed',
      statusText: 'done',
      body: 'body',
      bodyDelta: '+delta',
      bodyAppend: 'append',
      output: { content: 'output' },
      input: { command: 'npm test' },
      metadata: { server: 'new', tool: 'Bash' },
    }, createdAt);

    expect(findAssistantMessageWithToolPart(snapshot, 'agent-1', 'turn-1', 'tool-1')?.parts[0]).toMatchObject({
      title: 'Updated',
      status: 'completed',
      statusText: 'done',
      body: 'body',
      output: { content: 'output' },
      input: { command: 'npm test' },
      metadata: { server: 'new', tool: 'Bash', keep: true },
    });
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-1', statusText: null }, createdAt);
    expect(findTool(snapshot, 'tool-1')).not.toHaveProperty('statusText');
  });

  it('uses output text, appends body fragments, and creates fallback tools', () => {
    const snapshot = emptySnapshot();
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', runningTool('tool-1'), createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-1', bodyDelta: 'one' }, createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-1', bodyAppend: 'two' }, createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-1', output: 'three' }, createdAt);
    expect(findTool(snapshot, 'tool-1')).toMatchObject({ body: 'three' });

    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'missing' }, createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', {
      itemId: 'fallback', fallbackToolPart: runningTool('fallback'), status: 'failed',
    }, createdAt);
    expect(findTool(snapshot, 'fallback')).toMatchObject({ status: 'failed' });

    const messageWithText = assistant('assistant-turn-2', 'turn-2');
    messageWithText.parts.push({ type: 'text', text: 'Working' });
    snapshot.messages.push(messageWithText);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-2', {
      itemId: 'fallback-existing-message', fallbackToolPart: runningTool('fallback-existing-message'),
    }, createdAt);
    expect(findTool(snapshot, 'fallback-existing-message')).toBeDefined();
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-2', { itemId: 'fallback-existing-message', output: undefined }, createdAt);
  });

  it('upserts tools while preserving omitted state and clearing completed status text', () => {
    const snapshot = emptySnapshot();
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', {
      ...runningTool('tool-1'), body: 'body', input: 'input', output: 'output', statusText: 'running', metadata: { first: true },
    }, createdAt);
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', {
      ...runningTool('tool-1'), title: 'Renamed', metadata: { second: true },
    }, createdAt);
    expect(findTool(snapshot, 'tool-1')).toMatchObject({
      title: 'Renamed', body: 'body', input: 'input', output: 'output', statusText: 'running', metadata: { first: true, second: true },
    });
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', { ...runningTool('tool-1'), status: 'completed' }, createdAt);
    expect(findTool(snapshot, 'tool-1')?.statusText).toBeUndefined();

    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', runningTool('tool-2'), createdAt);
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', { ...runningTool('tool-2'), metadata: { added: true } }, createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-2', metadata: { updated: true } }, createdAt);
    expect(findTool(snapshot, 'tool-2')?.metadata).toStrictEqual({ added: true, updated: true });
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', runningTool('tool-3'), createdAt);
    updateAssistantToolPart(snapshot, 'agent-1', 'turn-1', { itemId: 'tool-3', metadata: { first: true } }, createdAt);
    expect(findTool(snapshot, 'tool-3')?.metadata).toStrictEqual({ first: true });
  });

  it('binds approvals to matching MCP tools and parses arguments', () => {
    const snapshot = emptySnapshot();
    upsertAssistantToolPart(snapshot, 'agent-1', 'turn-1', {
      ...runningTool('mcp-1'), kind: 'mcp', title: 'github.create_issue', metadata: { server: 'github', tool: 'create_issue' },
    }, createdAt);
    applyApprovalRequest(snapshot, 'agent-1', 'turn-1', approval('approval-1', 'github', 'create_issue', '{"title":"Bug"}'), createdAt);
    expect(findTool(snapshot, 'mcp-1')).toMatchObject({
      input: { title: 'Bug' },
      metadata: { confirmationRequestId: 'approval-1', server: 'github', tool: 'create_issue' },
    });
    expect(snapshot.messages.flatMap((message) => message.parts).filter((part) => part.type === 'tool')).toHaveLength(1);
  });

  it('reuses a sole pending MCP tool or creates a dedicated approval tool', () => {
    const sole = emptySnapshot();
    upsertAssistantToolPart(sole, 'agent-1', 'turn-1', { ...runningTool('mcp-1'), kind: 'mcp', title: 'unknown' }, createdAt);
    applyApprovalRequest(sole, 'agent-1', 'turn-1', approval('approval-1', 'github', 'create_issue', 'plain arguments'), createdAt);
    expect(findTool(sole, 'mcp-1')).toMatchObject({ input: 'plain arguments', title: 'github.create_issue' });

    const multiple = emptySnapshot();
    upsertAssistantToolPart(multiple, 'agent-1', 'turn-1', { ...runningTool('mcp-1'), kind: 'mcp', title: 'one' }, createdAt);
    upsertAssistantToolPart(multiple, 'agent-1', 'turn-1', { ...runningTool('mcp-2'), kind: 'mcp', title: 'two' }, createdAt);
    applyApprovalRequest(multiple, 'agent-1', 'turn-1', approval('approval-2', 'github', 'create_issue', ''), createdAt);
    expect(findTool(multiple, 'approval-approval-2')).toMatchObject({ input: undefined, title: 'github.create_issue' });
  });

  it('represents ask-user requests as provider-owned tool parts', () => {
    const snapshot = emptySnapshot();
    applyToolInputRequest(snapshot, 'agent-1', 'turn-1', {
      id: 'question-1',
      kind: 'ask_user',
      payload: { request: {
        itemId: 'ask-1',
        questions: [{ id: 'q1', header: 'Approach', question: 'Which approach?', isOther: false, isSecret: false, options: [] }],
      } },
    }, createdAt);
    expect(findTool(snapshot, 'ask-1')).toMatchObject({
      title: 'ask_user_question', input: [expect.objectContaining({ question: 'Which approach?' })], metadata: { requestId: 'question-1', question: 'Which approach?' },
    });
  });
});

describe('Claude conversation plan helpers', () => {
  it('accumulates and completes explicit proposed-plan events', () => {
    const snapshot = emptySnapshot();
    appendAgentPlanMarkdownDelta(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', delta: '' }, createdAt);
    appendAgentPlanMarkdownDelta(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', delta: '1. Inspect\n' }, createdAt);
    appendAgentPlanMarkdownDelta(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', delta: '2. Fix' }, createdAt);
    expect(snapshot.plan).toMatchObject({ markdown: '1. Inspect\n2. Fix', status: 'inProgress' });
    updateAgentPlanMarkdown(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', markdown: '  Final plan  ' }, createdAt);
    expect(snapshot.plan).toMatchObject({ markdown: 'Final plan', status: 'completed' });
    const completed = snapshot.plan;
    updateAgentPlanMarkdown(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', markdown: 'Final plan' }, createdAt);
    expect(snapshot.plan).toBe(completed);
    updateAgentPlanMarkdown(snapshot, 'session-1', 'turn-1', { itemId: 'plan-1', markdown: ' ' }, createdAt);
    expect(snapshot.plan?.markdown).toBe('Final plan');
  });

  it('filters inline plan tags while preserving visible text across chunks', () => {
    const snapshot = emptySnapshot();
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', 'session-1', 'turn-1', 'Before <PROPOSED_PLAN>1. Inspect', 'item-1', createdAt, 'commentary');
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', 'session-1', 'turn-1', '\n2. Fix</proposed_plan> After', 'item-1', createdAt, 'final_answer');

    expect(snapshot.plan).toMatchObject({ markdown: '1. Inspect\n2. Fix', status: 'completed' });
    expect(snapshot.messages.flatMap((message) => message.parts).filter((part) => part.type === 'text')).toStrictEqual([
      expect.objectContaining({ text: 'Before ', phase: 'commentary' }),
      expect.objectContaining({ text: ' After', phase: 'final_answer' }),
    ]);
    expect(findTool(snapshot, 'plan-turn-1')).toMatchObject({
      status: 'completed', metadata: { capturingProposedPlan: false, planProgress: true },
    });
  });

  it('passes ordinary deltas through and identifies plan write versus update', () => {
    const snapshot = emptySnapshot();
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', undefined, 'turn-1', 'No thread', undefined, createdAt);
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', 'session-1', 'turn-1', '', undefined, createdAt);
    expect(snapshot.messages[0]?.parts).toStrictEqual([{ type: 'text', text: 'No thread' }]);
    expect(planProgressOperation(snapshot, 'turn-1')).toBe('write');
    snapshot.plan = {
      threadId: 'session-1', turnId: 'turn-old', kind: 'proposed', status: 'completed', explanation: '', steps: [], markdown: 'Old', updatedAt: createdAt,
    };
    expect(planProgressOperation(snapshot, 'turn-1')).toBe('update');
    upsertPlanProgressToolPart(snapshot, 'agent-1', 'turn-1', 'one\n\ntwo', 'running', 'update', createdAt, true);
    expect(JSON.parse(findTool(snapshot, 'plan-turn-1')?.statusText ?? '{}')).toMatchObject({
      params: { addedLines: 2, operation: 'update', target: 'plan' },
    });
  });

  it('handles an empty inline proposed-plan block without fabricating plan content', () => {
    const snapshot = emptySnapshot();
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', 'session-1', 'turn-1', '<proposed_plan>', undefined, createdAt);
    appendAssistantDeltaWithPlanFilter(snapshot, 'agent-1', 'session-1', 'turn-1', '</proposed_plan>', undefined, createdAt);
    expect(snapshot.plan).toBeNull();
    expect(findTool(snapshot, 'plan-turn-1')).toMatchObject({ status: 'running' });
  });
});

describe('Claude conversation reducer ownership', () => {
  it('ignores events for another agent and leaves resolved-request bookkeeping to the replica', () => {
    const snapshot = emptySnapshot();
    const otherAgentError = {
      seq: 1, occurredAt: createdAt, agentId: 'agent-2', backend: 'claude' as const,
      type: 'error' as const, payload: { message: 'wrong owner' },
    };
    applyClaudeConversationEvent(snapshot, otherAgentError);
    applyClaudeConversationEvent(snapshot, {
      seq: 2, occurredAt: createdAt, agentId: 'agent-1', backend: 'claude',
      type: 'clientRequest.resolved', payload: { id: 'request-1' },
    });
    expect(snapshot).toStrictEqual(emptySnapshot());
  });
});

function emptySnapshot(): ClaudeConversationSnapshot {
  return {
    agentId: 'agent-1', sessionId: 'session-1', activeTurnId: null, turnIds: [], turns: [], messages: [],
    answeredClientRequestIds: [], busy: false, historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null,
  };
}

function assistant(id: string, turnId: string): RendererMessage {
  return { id, agentId: 'agent-1', role: 'assistant', status: 'streaming', turnId, createdAt, parts: [] };
}

function user(id: string, text: string): RendererMessage {
  return { id, agentId: 'agent-1', role: 'user', status: 'complete', createdAt, parts: [{ type: 'text', text }] };
}

function runningTool(id: string): RendererToolPart {
  return { type: 'tool', id, kind: 'command', title: id, status: 'running' };
}

function findTool(snapshot: ClaudeConversationSnapshot, id: string): RendererToolPart | undefined {
  return snapshot.messages.flatMap((message) => message.parts)
    .find((part): part is RendererToolPart => part.type === 'tool' && part.id === id);
}

function approval(id: string, integrationId: string, toolName: string, argumentsPreview: string) {
  return {
    id,
    kind: 'confirm_tool' as const,
    payload: { confirmation: {
      integrationId,
      integrationName: integrationId,
      toolName,
      summary: 'Run tool',
      argumentsPreview,
      allowConversation: true,
      allowAlways: false,
    } },
  };
}

function agent(backendSession?: Agent['backendSession']): Agent {
  return {
    id: 'agent-1', name: 'Dina', folder: '/repo', backend: backendSession?.kind ?? 'codex',
    ...(backendSession ? { backendSession } : {}), status: { type: 'idle' },
    createdAt, updatedAt: createdAt,
  };
}
