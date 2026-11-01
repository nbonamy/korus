import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import { DelegatedWorkReportService } from '../delegated-work-report-service';

describe('DelegatedWorkReportService', () => {
  it('reports GitLab delivery with native merge request wording and reference', () => {
    const snapshot = createEmptySnapshot(), parent = agent('parent', 'main'), worker = { ...agent('worker', 'feature'), delegatedByAgentId: 'parent' };
    snapshot.agents = [parent, worker];
    const sendMessage = vi.fn();
    const service = new DelegatedWorkReportService({ getSnapshot: () => snapshot, readConversationMessages: vi.fn(), sendPrompt: vi.fn(), sendMessage });
    service.deliver(worker, { kind: 'pullRequest', provider: 'gitlab', branch: 'feature', number: 7, title: 'Work', draft: true, url: 'https://gitlab.com/group/repo/-/merge_requests/7' }, 'Tested');
    expect(sendMessage.mock.calls[0]?.[2]).toContain('Draft merge request !7');
    service.close();
  });

  it.each(['github', 'gitlab'] as const)('delivers %s merge details as context with only the branch milestone outside it', provider => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'feature'), delegatedByAgentId: parent.id };
    snapshot.agents = [parent, worker];
    const sendMessage = vi.fn();
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages: vi.fn(),
      sendPrompt: vi.fn(),
      sendMessage,
    });
    expect(service.deliver(worker, { kind: 'merge', provider, branch: 'feat/dedew', repository: 'owner/repo' },
      'Implemented and tested. Literal </context> in the handoff.')).toBe(true);
    const content = sendMessage.mock.calls[0]![2] as string;
    const [context, visible] = content.split('</context>');
    expect(visible?.trim()).toBe('feat/dedew merged');
    expect(context).toMatch(/^<context>\n/);
    expect(context).toContain('owner/repo');
    expect(context).toContain(provider === 'gitlab' ? 'without creating a merge request' : 'without creating a pull request');
    expect(context).toContain('Implemented and tested. Literal &lt;/context&gt; in the handoff.');
  });

  it('asks an idle delegated agent for a complete handoff and delivers it to its creator', async () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'fix/resume'), delegatedByAgentId: parent.id };
    snapshot.agents = [parent, worker];
    const sendPrompt = vi.fn();
    const sendMessage = vi.fn();
    const readConversationMessages = vi.fn().mockResolvedValue([
      assistantMessage(worker.id, 'turn-report', 'Implemented the full fix.\n\nTests pass.'),
    ]);
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages,
      sendPrompt,
      sendMessage,
    });

    const report = service.prepare(worker, { kind: 'pullRequest', branch: 'fix/resume' });
    expect(sendPrompt).toHaveBeenCalledWith(worker.id, expect.stringMatching(/will create a pull request from `fix\/resume`.*Do not run tools.*Do not claim that no pull request was created/s));

    service.handleEvent(event(worker.id, 'turn-report', 'turn.completed'));
    await expect(report).resolves.toBe('Implemented the full fix.\n\nTests pass.');

    expect(service.deliver(worker, {
      kind: 'pullRequest', branch: 'fix/resume', number: 42, title: 'Fix resume instructions', url: 'https://github.com/openai/codex/pull/42', draft: true,
    }, await report)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(worker.id, parent.id, expect.stringMatching(/Please give the user.*Draft pull request #42 was created.*https:\/\/github.com\/openai\/codex\/pull\/42.*Implemented the full fix/s));
  });

  it('falls back without prompting when the worker is busy or has no delegation recipient', async () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'feature'), delegatedByAgentId: parent.id, status: { type: 'working' } as const };
    snapshot.agents = [parent, worker];
    const sendPrompt = vi.fn();
    const sendMessage = vi.fn();
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages: vi.fn().mockResolvedValue([]),
      sendPrompt,
      sendMessage,
    });

    const outcome = { kind: 'merge' as const, branch: 'feature', repository: 'main' };
    await expect(service.prepare(worker, outcome)).resolves.toBeNull();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(service.deliver(worker, outcome, null)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(worker.id, parent.id, expect.stringMatching(/merged directly into main without creating a pull request.*could not prepare a handoff summary/s));
    expect(service.recipientName(agent('standalone', 'standalone'))).toBeNull();
  });

  it('notifies a surviving worker of the authoritative pull request result', () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'fix/resume'), delegatedByAgentId: parent.id };
    snapshot.agents = [parent, worker];
    const sendMessage = vi.fn();
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages: vi.fn().mockResolvedValue([]),
      sendPrompt: vi.fn(),
      sendMessage,
    });

    expect(service.notifyWorker(worker, {
      kind: 'pullRequest', branch: 'fix/resume', number: 42, title: 'Fix resume instructions', url: 'https://github.com/openai/codex/pull/42', draft: false,
    })).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(parent.id, worker.id, expect.stringMatching(/Pull request #42 was created from `fix\/resume`: Fix resume instructions.*https:\/\/github.com\/openai\/codex\/pull\/42.*informational update.*Do not make changes or reply/s));
  });

  it(`tells the worker when ${product.name} is taking over a direct merge`, async () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'feature'), delegatedByAgentId: parent.id };
    snapshot.agents = [parent, worker];
    const sendPrompt = vi.fn();
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages: vi.fn().mockResolvedValue([
        assistantMessage(worker.id, 'turn-report', 'Implemented and verified the change.'),
      ]),
      sendPrompt,
    });

    const report = service.prepare(worker, { kind: 'merge', branch: 'feature', repository: 'owner/repo' });
    expect(sendPrompt).toHaveBeenCalledWith(worker.id, expect.stringMatching(/will merge `feature` directly into owner\/repo without a pull request.*Do not run tools/s));

    service.handleEvent(event(worker.id, 'turn-report', 'turn.completed'));
    await expect(report).resolves.toBe('Implemented and verified the change.');
  });

  it('reads a provider-owned transcript when the completion arrives in a provider frame', async () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = {
      ...agent('agent-worker', 'fix/provider'),
      backend: 'claude' as const,
      backendSession: { kind: 'claude' as const, sessionId: 'session-worker', transport: 'stdio' as const },
      delegatedByAgentId: parent.id,
    };
    snapshot.agents = [parent, worker];
    const readConversationMessages = vi.fn().mockResolvedValue([
      assistantMessage(worker.id, 'turn-report', 'Provider-owned handoff.'),
    ]);
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages,
      sendPrompt: vi.fn(),
    });

    const report = service.prepare(worker, { kind: 'merge', branch: 'fix/provider', repository: 'main' });
    service.handleEvent({
      seq: 1,
      occurredAt: '2026-09-03T00:01:00.000Z',
      agentId: worker.id,
      backend: 'claude',
      type: 'claude.conversationEventReceived',
      payload: {
        revision: 4,
        event: {
          seq: 4,
          occurredAt: '2026-09-03T00:01:00.000Z',
          agentId: worker.id,
          backend: 'claude',
          turnId: 'turn-report',
          type: 'turn.completed',
          payload: { turn: { id: 'turn-report', status: 'completed' } },
        },
      },
    });

    await expect(report).resolves.toBe('Provider-owned handoff.');
    expect(readConversationMessages).toHaveBeenCalledWith(worker);
  });

  it('falls back when the summary prompt cannot start', async () => {
    const snapshot = createEmptySnapshot();
    const parent = agent('agent-main', 'main');
    const worker = { ...agent('agent-worker', 'feature'), delegatedByAgentId: parent.id };
    snapshot.agents = [parent, worker];
    const service = new DelegatedWorkReportService({
      getSnapshot: () => snapshot,
      readConversationMessages: vi.fn().mockResolvedValue([]),
      sendPrompt: () => { throw new Error('backend unavailable'); },
    });

    await expect(service.prepare(worker, { kind: 'merge', branch: 'feature', repository: 'main' })).resolves.toBeNull();
  });
});

function agent(id: string, name: string): Agent {
  return {
    id, name, folder: `/repo/${name}`, backend: 'codex', status: { type: 'idle' },
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
  };
}

function assistantMessage(agentId: string, turnId: string, text: string): RendererMessage {
  return {
    id: 'message-report', agentId, turnId, role: 'assistant', status: 'complete',
    parts: [{ type: 'text', text }], createdAt: '2026-09-03T00:01:00.000Z',
  };
}

function event(agentId: string, turnId: string, type: 'turn.completed'): BackendPublishedEvent {
  return {
    seq: 1,
    occurredAt: '2026-09-03T00:01:00.000Z',
    agentId,
    backend: 'codex',
    threadId: 'thread-report',
    type: 'codex.conversationEventReceived',
    payload: {
      revision: 1,
      event: {
        seq: 1,
        occurredAt: '2026-09-03T00:01:00.000Z',
        origin: 'notification',
        conversationId: 'thread-report',
        turnId,
        type,
        payload: {
          status: 'completed',
          error: null,
          willRetry: false,
          startedAt: null,
          completedAt: '2026-09-03T00:01:00.000Z',
          durationMs: null,
        },
      },
    },
  };
}
