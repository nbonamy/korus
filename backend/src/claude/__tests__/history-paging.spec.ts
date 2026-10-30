import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Agent, RendererMessage } from '@workspace/core/contracts';
import { createClaudeConversationReplica, type ClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import type { ClaudeSdkMessage } from '../protocol';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { ClaudeBackendDriver } from '../claude-driver';
import { loadClaudeTranscriptHistory, type ClaudeTranscriptHistory, claudeTranscriptToRendererMessages } from '../transcript-history-adapter';

const session = { kind: 'claude' as const, sessionId: 'history-session', transport: 'stdio' as const };
const agent: Agent = { id: 'history-agent', name: 'History', folder: '/synthetic', backend: 'claude', backendSession: session,
  status: { type: 'idle' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

function transcript(turns: number, output: string) {
  return Array.from({ length: turns }, (_, i) => [
    { type: 'user', uuid: `user-${i}`, message: { content: `Read file ${i}` } },
    { type: 'assistant', uuid: `assistant-${i}`, message: { content: [{ type: 'tool_use', id: `tool-${i}`, name: 'Read', input: { file_path: `/synthetic/${i}.txt` } }] } },
    { type: 'user', uuid: `result-${i}`, message: { content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: output }] } },
  ]).flat().map((row) => JSON.stringify(row)).join('\n');
}

describe('Claude history paging', () => {
  it('publishes summaries across pages and expands one turn losslessly without disturbing live work or cached reopens', async () => {
    const source = Array.from({ length: 80 }, (_, i) => [
      { type: 'user', uuid: `user-${i}`, promptId: `prompt-${i}`, timestamp: '2026-01-01T00:00:00Z', message: { content: `Request ${i}` } },
      { type: 'assistant', uuid: `work-${i}`, timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'text', text: `Inspecting ${i}` }, { type: 'tool_use', id: `read-${i}`, name: 'Read', input: { file_path: `/synthetic/${i}` } }] } },
      { type: 'user', uuid: `result-${i}`, message: { content: [{ type: 'tool_result', tool_use_id: `read-${i}`, content: `private-work-${i} ` + 'x'.repeat(10000) }] } },
      ...(i === 20 ? [
        { type: 'system', subtype: 'compact_boundary', uuid: 'boundary', timestamp: '2026-01-01T00:00:30Z' },
        { type: 'user', uuid: 'compaction-summary', promptId: 'prompt-20', isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: '2026-01-01T00:00:31Z', message: { content: 'INTERNAL COMPACTION CONTEXT' } },
      ] : []),
      ...(i === 21 ? [{ type: 'user', uuid: 'interruption', promptId: 'prompt-21', timestamp: '2026-01-01T00:00:31Z', message: { content: '[Request interrupted by user for tool use]' } }] : []),
      { type: 'assistant', uuid: `answer-${i}`, timestamp: '2026-01-01T00:01:49Z', message: { content: i === 19 ? [] : [{ type: 'text', text: `Answer ${i}` }] } },
    ]).flat().map(row => JSON.stringify(row)).join('\n');
    const turns: import('@workspace/core/contracts').ClaudeConversationTurn[] = [];
    const messages = claudeTranscriptToRendererMessages(source, agent.id, session.sessionId, undefined, undefined, false, undefined, turns);
    let emit!: (message: ClaudeSdkMessage) => void;
    const driver = new ClaudeBackendDriver({ startTurn: (_params, listener) => { emit = listener; return { done: new Promise(() => {}), interrupt: async () => {} }; }, close: async () => {} }, async () => ({ backendSession: session, messages, turns }));
    let replica!: ClaudeConversationReplica; const frames: BackendEvent[] = [];
    driver.onEvent(frame => { decodeAppBackendEvent({ ...frame, seq: frames.length + 1, occurredAt: '2026-01-01T00:00:00Z' }); frames.push(frame); if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot); if (frame.type === 'claude.conversationEventReceived') replica.apply(frame.payload.event); });
    try {
      await driver.loadConversation(agent);
      expect(JSON.stringify(replica.getSnapshot().messages).includes('private-work-')).toBe(false);
      expect(replica.getSnapshot().turns.at(-1)).toMatchObject({ itemsView: 'summary', durationMs: 109000 });
      while (replica.getSnapshot().historyState.hasOlder) await driver.loadOlderHistory(agent);
      expect(replica.getSnapshot().messages.filter(message => message.role === 'user')).toHaveLength(81);
      expect(new Set(replica.getSnapshot().messages.map(message => message.id)).size).toBe(replica.getSnapshot().messages.length);
      expect(turns).toHaveLength(80);
      expect(new Set(messages.map(message => message.id)).size).toBe(messages.length);
      expect(messages.find(message => message.kind === 'compaction')?.turnId).toBe(turns[20]!.id);
      const target = turns[20]!.id;
      const before = replica.getSnapshot().messages.map(message => message.id);
      await driver.loadTurnHistory(agent, target);
      expect(replica.getSnapshot().messages.map(message => message.id)).toStrictEqual(before);
      expect(replica.getSnapshot().turns.find(turn => turn.id === target)).toMatchObject({ itemsView: 'full', detailsLoading: false });
      expect(JSON.stringify(replica.getSnapshot().messages)).toContain('private-work-20');
      expect(JSON.stringify(replica.getSnapshot().messages)).not.toContain('private-work-21');
      const count = frames.length; await driver.loadTurnHistory(agent, target); expect(frames).toHaveLength(count);
      expect(await driver.readConversationMessages({ backend: 'claude', folder: agent.folder, sessionId: session.sessionId }, agent.id)).toStrictEqual(messages);
      const workOnly = messages.find(message => message.role === 'assistant' && message.turnId === turns[19]!.id)!;
      expect(replica.getSnapshot().messages.find(message => message.id === workOnly.id)?.parts).toStrictEqual([]);
      const live = await driver.sendPrompt(agent, 'Live request');
      emit({ type: 'assistant', session_id: session.sessionId, message: { content: [{ type: 'text', text: 'Live text' }] } });
      await driver.loadTurnHistory(agent, turns[21]!.id);
      expect(JSON.stringify(replica.getSnapshot().messages)).toContain('private-work-21');
      expect(replica.getSnapshot()).toMatchObject({ activeTurnId: live.turnId, busy: true });
      expect(JSON.stringify(replica.getSnapshot().messages)).toContain('Live text');
      expect(replica.getSnapshot().messages.some(message => message.id === workOnly.id)).toBe(true);
      expect(replica.getSnapshot().turns.find(turn => turn.id === live.turnId)?.itemsView).not.toBe('summary');
      await driver.releaseConversation(agent.id);
      await expect(driver.loadTurnHistory(agent, target)).rejects.toThrow('no longer open');
    } finally { await driver.close(); }
  });

  it('expands a turn spanning multiple history pages in source order without losing earlier turns', async () => {
    const source = [transcript(5, 'Earlier work'), JSON.stringify({ type: 'user', uuid: 'root', promptId: 'large-turn', message: { content: 'One long interrupted turn' } }),
      ...Array.from({ length: 60 }, (_, i) => [
        { type: 'assistant', uuid: `segment-${i}`, message: { content: [{ type: 'text', text: `Commentary ${i}` }, { type: 'tool_use', id: `read-segment-${i}`, name: 'Read', input: { file_path: `/synthetic/${i}` } }] } },
        { type: 'user', uuid: `result-segment-${i}`, message: { content: [{ type: 'tool_result', tool_use_id: `read-segment-${i}`, content: `Segment output ${i}` }] } },
        { type: 'user', uuid: `steer-${i}`, promptId: 'large-turn', message: { content: `Adjustment ${i}` } },
      ]).flat().map(row => JSON.stringify(row)),
      JSON.stringify({ type: 'assistant', uuid: 'final', message: { content: 'Final long-turn answer' } }),
    ].join('\n');
    const turns: import('@workspace/core/contracts').ClaudeConversationTurn[] = [];
    const messages = claudeTranscriptToRendererMessages(source, agent.id, session.sessionId, undefined, undefined, false, undefined, turns);
    const home = await mkdtemp(path.join(os.tmpdir(), 'claude-long-turn-'));
    const project = path.join(home, '-synthetic'); await mkdir(project);
    const file = path.join(project, `${session.sessionId}.jsonl`); await writeFile(file, source);
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, owner => loadClaudeTranscriptHistory(owner, { projectsRoot: home }), { homeDir: home });
    let replica!: ClaudeConversationReplica;
    driver.onEvent(frame => {
      if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot);
      if (frame.type === 'claude.conversationEventReceived') replica.apply(frame.payload.event);
    });
    try {
      await driver.loadConversation(agent);
      expect(replica.getSnapshot().messages.length).toBeLessThan(messages.filter(message => message.turnId === 'claude-large-turn').length);
      await driver.loadTurnHistory(agent, 'claude-large-turn');
      expect(replica.getSnapshot().messages.map(message => message.id)).toStrictEqual(messages.filter(message => message.turnId === 'claude-large-turn').map(message => message.id));
      expect(JSON.stringify(replica.getSnapshot().messages)).toContain('Segment output 0');
      await driver.loadConversation(agent);
      expect(replica.getSnapshot().turns.find(turn => turn.id === 'claude-large-turn')?.itemsView).toBe('summary');
      await rename(file, `${file}.offline`);
      await driver.loadTurnHistory(agent, 'claude-large-turn');
      expect(replica.getSnapshot().messages.map(message => message.id)).toStrictEqual(messages.filter(message => message.turnId === 'claude-large-turn').map(message => message.id));
      await rename(`${file}.offline`, file);
      await driver.loadOlderHistory(agent);
      expect(replica.getSnapshot().messages.map(message => message.id)).toStrictEqual(messages.map(message => message.id));
      expect(replica.getSnapshot().historyState.hasOlder).toBe(false);
      expect(await driver.readConversationMessages({ backend: 'claude', folder: agent.folder, sessionId: session.sessionId }, agent.id)).toStrictEqual(messages);
    } finally { await driver.close(); await rm(home, { recursive: true, force: true }); }
  });

  it.each(['release', 'selection'] as const)('discards a pending disk expansion after %s', async cancellation => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'claude-details-race-'));
    const project = path.join(home, '-synthetic'); await mkdir(project);
    await writeFile(path.join(project, `${session.sessionId}.jsonl`), transcript(1, 'Old disk detail'));
    const original = await loadClaudeTranscriptHistory(agent, { projectsRoot: home });
    let resolveNext!: (history: ClaudeTranscriptHistory) => void;
    const nextHistory = new Promise<ClaudeTranscriptHistory>(resolve => { resolveNext = resolve; });
    const nextAgent = { ...agent, backendSession: { ...session, sessionId: 'next-session' } };
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, owner => owner.backendSession?.kind === 'claude' && owner.backendSession.sessionId === session.sessionId ? Promise.resolve(original) : nextHistory);
    const frames: BackendEvent[] = []; let cancelled: Promise<unknown> | undefined;
    driver.onEvent(frame => {
      frames.push(frame);
      if (frame.type === 'claude.conversationEventReceived' && frame.payload.event.type === 'turn.historyUpdated' && frame.payload.event.payload.turn.detailsLoading) {
        cancelled = cancellation === 'release' ? driver.releaseConversation(agent.id) : driver.loadConversation(nextAgent);
      }
    });
    try {
      await driver.loadConversation(agent);
      const first = driver.loadTurnHistory(agent, original!.turns![0]!.id);
      const settled = await Promise.allSettled([first]);
      expect(settled[0]).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
      expect(JSON.stringify(frames)).not.toContain('Old disk detail');
      resolveNext({ backendSession: nextAgent.backendSession, messages: [] });
      await cancelled;
      if (cancellation === 'selection') expect(frames.at(-1)).toMatchObject({ type: 'claude.conversationSnapshotChanged', payload: { snapshot: { sessionId: 'next-session', messages: [] } } });
    } finally {
      resolveNext({ backendSession: nextAgent.backendSession, messages: [] });
      await cancelled?.catch(() => undefined); await driver.close(); await rm(home, { recursive: true, force: true });
    }
  });

  it('retains older history when an interrupted session continues before its conversation is opened', async () => {
    const messages = claudeTranscriptToRendererMessages(transcript(80, 'past output'), agent.id, session.sessionId);
    const driver = new ClaudeBackendDriver({ startTurn: () => ({ done: new Promise(() => {}), interrupt: async () => {} }), close: async () => {} },
      async () => ({ backendSession: session, messages }));
    let replica!: ClaudeConversationReplica;
    driver.onEvent(frame => {
      if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot);
      if (frame.type === 'claude.conversationEventReceived') replica.apply(frame.payload.event);
    });
    try {
      const resumed = await driver.continueInterruptedTurn(agent);
      await driver.loadConversation(agent);
      expect(replica.getSnapshot()).toMatchObject({ activeTurnId: resumed.activeTurnId, busy: true, historyState: { hasOlder: true } });
      const visible = replica.getSnapshot().messages;
      await driver.loadOlderHistory(agent);
      expect(replica.getSnapshot().messages.length).toBeGreaterThan(visible.length);
      expect(replica.getSnapshot().messages.slice(-visible.length)).toStrictEqual(visible);
    } finally { await driver.close(); }
  });

  it('prepends bounded pages without gaps or duplicate identities and exhausts idempotently', async () => {
    const messages: RendererMessage[] = Array.from({ length: 150 }, (_, i) => ({ id: `message-${i}`, agentId: agent.id, turnId: `turn-${i}`, role: 'user', status: 'complete', createdAt: '2026-01-01T00:00:00Z', parts: [{ type: 'text', text: 'x'.repeat(40_000) }] }));
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, async () => ({ backendSession: session, messages }));
    let replica!: ClaudeConversationReplica;
    const frames: BackendEvent[] = [];
    driver.onEvent((frame) => {
      frames.push(frame);
      if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot);
      if (frame.type === 'claude.conversationEventReceived') replica.apply(frame.payload.event);
    });
    try {
      await driver.loadConversation(agent);
      expect(replica.getSnapshot().messages.length).toBeLessThan(50); // Byte budget, not just the count.
      while (replica.getSnapshot().historyState.hasOlder) {
        const visible = replica.getSnapshot().messages;
        const result = await driver.loadOlderHistory(agent);
        expect(result.frame?.payload.event.type).toBe('history.prepended');
        expect(replica.getSnapshot().messages.slice(-visible.length)).toStrictEqual(visible);
      }
      expect(replica.getSnapshot().messages).toStrictEqual(messages);
      await driver.loadOlderHistory(agent);
      expect(replica.getSnapshot().messages).toStrictEqual(messages);
      expect(frames.every((frame) => Buffer.byteLength(JSON.stringify(frame)) < 1.5 * 1024 * 1024)).toBe(true);
    } finally { await driver.close(); }
  });

  it('reads a giant tool row losslessly in bounded chunks and rejects foreign, stale and invalid reads', async () => {
    const messages = claudeTranscriptToRendererMessages(transcript(1, '工具🙂\\\"\n'.repeat(700_000)), agent.id, session.sessionId);
    expect(Buffer.byteLength(JSON.stringify(messages[1]))).toBeGreaterThan(8 * 1024 * 1024);
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, async () => ({ backendSession: session, messages }));
    let snapshot!: import('@workspace/core/contracts').ClaudeConversationSnapshot;
    driver.onEvent((frame) => { if (frame.type === 'claude.conversationSnapshotChanged') snapshot = frame.payload.snapshot; });
    try {
      await driver.loadConversation(agent);
      const deferred = snapshot.messages[1]!.deferredContent!;
      expect(deferred.byteLength).toBeGreaterThan(8 * 1024 * 1024);
      const input = { sessionId: session.sessionId, contentId: deferred.contentId, offset: 0 };
      const chunks: Buffer[] = [];
      while (true) {
        const chunk = await driver.readConversationContent(agent, input);
        expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(90_000);
        chunks.push(Buffer.from(chunk.data, 'base64'));
        if (chunk.nextOffset === null) break;
        input.offset = chunk.nextOffset;
      }
      expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toStrictEqual(messages[1]);
      expect(await driver.readConversationMessages({ backend: 'claude', folder: agent.folder, sessionId: session.sessionId }, agent.id)).toStrictEqual(messages);
      await expect(driver.readConversationContent({ ...agent, id: 'other' }, input)).rejects.toThrow('no longer available');
      await expect(driver.readConversationContent(agent, { ...input, sessionId: 'other' })).rejects.toThrow('no longer available');
      await expect(driver.readConversationContent(agent, { ...input, offset: -1 })).rejects.toThrow('offset');
      await driver.releaseConversation(agent.id);
      await expect(driver.readConversationContent(agent, input)).rejects.toThrow('no longer available');
    } finally { await driver.close(); }
  });

  it('ignores history reads invalidated by release or a newer session selection', async () => {
    const pending: Array<(value: { backendSession: typeof session; messages: RendererMessage[] }) => void> = [];
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, () => new Promise((resolve) => { pending.push(resolve); }));
    const frames: BackendEvent[] = []; driver.onEvent((frame) => frames.push(frame));
    try {
      const obsolete = driver.loadConversation(agent);
      await driver.releaseConversation(agent.id);
      pending[0]!({ backendSession: session, messages: [] }); await obsolete;
      expect(frames).toStrictEqual([]);
      const first = driver.loadConversation(agent);
      const secondAgent = { ...agent, backendSession: { ...session, sessionId: 'second' } };
      const second = driver.loadConversation(secondAgent);
      pending[2]!({ backendSession: secondAgent.backendSession, messages: [] }); await second;
      pending[1]!({ backendSession: session, messages: [] }); await first;
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ payload: { snapshot: { sessionId: 'second' } } });
      await expect(driver.loadOlderHistory(agent)).rejects.toThrow('no longer open');
    } finally { await driver.close(); }
  });

  it('keeps live tool output authoritative across older pages, oversized events and reload', async () => {
    let emit!: (message: ClaudeSdkMessage) => void;
    const messages = claudeTranscriptToRendererMessages(transcript(60, 'small'), agent.id, session.sessionId);
    const driver = new ClaudeBackendDriver({ startTurn: (_params, listener) => { emit = listener; return { done: new Promise(() => {}), interrupt: async () => {} }; }, close: async () => {} }, async () => ({ backendSession: session, messages }));
    let replica!: ClaudeConversationReplica;
    const frames: BackendEvent[] = [];
    driver.onEvent((frame) => { frames.push(frame); if (frame.type === 'claude.conversationSnapshotChanged') replica = createClaudeConversationReplica(frame.payload.snapshot); if (frame.type === 'claude.conversationEventReceived') replica.apply(frame.payload.event); });
    try {
      await driver.loadConversation(agent);
      const turn = await driver.sendPrompt(agent, 'Keep working');
      emit({ type: 'assistant', session_id: session.sessionId, message: { content: [{ type: 'tool_use', id: 'live-tool', name: 'Read', input: { file_path: '/synthetic/file' } }] } });
      const output = 'live content'.repeat(100_000);
      emit({ type: 'user', session_id: session.sessionId, message: { content: [{ type: 'tool_result', tool_use_id: 'live-tool', content: output }] } });
      await driver.loadOlderHistory(agent);
      expect(replica.getSnapshot()).toMatchObject({ activeTurnId: turn.turnId, busy: true });
      await driver.loadConversation(agent);
      emit({ type: 'assistant', session_id: session.sessionId, message: { content: 'Final answer' } });
      emit({ type: 'result', subtype: 'success', session_id: session.sessionId, is_error: false });
      const live = (await driver.readConversationMessages({ backend: 'claude', folder: agent.folder, sessionId: session.sessionId }, agent.id)).find((row) => row.role === 'assistant' && row.turnId === turn.turnId)!;
      expect(live.parts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'live-tool', body: output }), { type: 'text', text: 'Final answer' }]));
      expect(replica.getSnapshot().messages.filter((row) => row.role === 'assistant' && row.turnId === turn.turnId)).toHaveLength(1);
      const reference = replica.getSnapshot().messages.find((row) => row.id === live.id)!.deferredContent!;
      const chunks: Buffer[] = []; let offset = 0;
      while (true) {
        const chunk = await driver.readConversationContent(agent, { sessionId: session.sessionId, contentId: reference.contentId, offset });
        chunks.push(Buffer.from(chunk.data, 'base64'));
        if (chunk.nextOffset === null) break;
        offset = chunk.nextOffset;
      }
      expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toStrictEqual(live);
      expect(live.status).toBe('complete');
      expect(frames.every((frame) => Buffer.byteLength(JSON.stringify(frame)) < 1.5 * 1024 * 1024)).toBe(true);
    } finally { await driver.close(); }
  });

  it('opens a transcript larger than the companion limit with a bounded recent snapshot', async () => {
    const messages = claudeTranscriptToRendererMessages(transcript(80, '工具 output\n'.repeat(30_000)), agent.id, session.sessionId);
    expect(Buffer.byteLength(JSON.stringify(messages))).toBeGreaterThan(32 * 1024 * 1024);
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, async () => ({ backendSession: session, messages }));
    const frames: BackendEvent[] = [];
    driver.onEvent((frame) => frames.push(frame));
    try {
      await driver.loadConversation(agent);
      const frame = frames.find((event) => event.type === 'claude.conversationSnapshotChanged');
      expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(1.5 * 1024 * 1024);
      expect(frame).toMatchObject({ payload: { snapshot: { historyState: { hasOlder: true, loadingOlder: false },
        messages: expect.arrayContaining([expect.objectContaining({ id: messages.at(-1)!.id, turnId: messages.at(-1)!.turnId })]) } } });
    } finally { await driver.close(); }
  });

  it('shows a long turn with many ordinary tool results whole, with nothing to click', async () => {
    const parts = Array.from({ length: 40 }, (_, i) => ({ type: 'tool' as const, id: `tool-${i}`, kind: 'command', title: `Ran command ${i}`, status: 'completed' as const, body: `output ${i} `.repeat(500) }));
    const message: RendererMessage = { id: 'long-turn', agentId: agent.id, turnId: 'turn', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00Z', parts };
    expect(Buffer.byteLength(JSON.stringify(message))).toBeGreaterThan(100 * 1024);
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, async () => ({ backendSession: session, messages: [message] }));
    let snapshot!: import('@workspace/core/contracts').ClaudeConversationSnapshot;
    driver.onEvent((frame) => { if (frame.type === 'claude.conversationSnapshotChanged') snapshot = frame.payload.snapshot; });
    try {
      await driver.loadConversation(agent);
      expect(snapshot.messages).toStrictEqual([message]);
      expect(snapshot.messages[0]!.deferredContent).toBeUndefined();
    } finally { await driver.close(); }
  });

  it('cuts only the one huge tool result of a turn and keeps every row of it', async () => {
    const ordinary = (i: number) => ({ type: 'tool' as const, id: `tool-${i}`, kind: 'command', title: `Ran command ${i}`, status: 'completed' as const, body: `output ${i}` });
    const huge = { type: 'tool' as const, id: 'huge', kind: 'mcp', title: 'Screenshot', status: 'completed' as const, body: 'x'.repeat(300_000), output: [{ type: 'text', text: 'x'.repeat(300_000) }] };
    const message: RendererMessage = { id: 'mixed', agentId: agent.id, turnId: 'turn', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00Z',
      parts: [{ type: 'text', text: 'Looking at it' }, ordinary(1), huge, ordinary(2)] };
    const driver = new ClaudeBackendDriver({ startTurn: vi.fn(), close: async () => {} }, async () => ({ backendSession: session, messages: [message] }));
    let snapshot!: import('@workspace/core/contracts').ClaudeConversationSnapshot;
    driver.onEvent((frame) => { if (frame.type === 'claude.conversationSnapshotChanged') snapshot = frame.payload.snapshot; });
    try {
      await driver.loadConversation(agent);
      const shown = snapshot.messages[0]!;
      expect(shown.parts).toHaveLength(4);
      expect(shown.parts[0]).toStrictEqual(message.parts[0]);
      expect(shown.parts[1]).toStrictEqual(message.parts[1]);
      expect(shown.parts[3]).toStrictEqual(message.parts[3]);
      expect(shown.parts[2]).toMatchObject({ id: 'huge', kind: 'mcp', title: 'Screenshot', status: 'completed' });
      expect(Buffer.byteLength(JSON.stringify(shown.parts[2]))).toBeLessThan(16 * 1024);
      expect(shown.deferredContent).toBeDefined();
    } finally { await driver.close(); }
  });
});
