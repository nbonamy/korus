import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { AppStateStore } from '../persistence/store';

it('injects an editable HTML review that survives restart and switches to the text fixture', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'html-plan-debug-'));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  agent.backendSession = { kind: 'codex', threadId: 'fixture-conversation' };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: next => store.save(next) });
  try {
    const inject = (format: 'text' | 'html') => server.handleMessage({
      jsonrpc: '2.0', id: format, method: backendMethods.debugPlanReadyForReviewInject,
      params: { agentId: agent.id, format },
    });
    const published = await inject('html');
    expect(published).not.toHaveProperty('error');
    const plan = snapshot.agents[0]!.interactivePlan!;
    expect(plan).toMatchObject({ agentId: agent.id, conversationId: 'fixture-conversation', revision: 1 });
    const section = plan.document.sections.find(section => section.decision)!;
    const answers = { choices: { [section.id]: section.decision!.options[1]!.id }, comments: { [section.id]: 'Include cancellation.' } };
    await server.handleMessage({ jsonrpc: '2.0', id: 'save', method: backendMethods.agentInteractivePlanRespond,
      params: { agentId: agent.id, response: { action: 'save', planId: plan.id, revision: 1, answerVersion: 0, answers } },
    });
    const restored = await new AppStateStore(home).load();
    expect(restored.agents[0]!.interactivePlan!.answers).toStrictEqual(answers);
    expect(restored.agents[0]!.interactivePlan!.document).toStrictEqual(plan.document);
    expect(restored.agents[0]!.interactivePlan!.document.sections[0]!.exhibit!.screens).toHaveLength(2);
    expect(restored.agents[0]!.planReview!.status).toBe('pending');
    expect(snapshot.agents[1]!.interactivePlan).toBeUndefined();
    await inject('text');
    const text = await new AppStateStore(home).load();
    expect(text.agents[0]!.interactivePlan).toBeUndefined();
    expect(text.agents[0]!.planReview!.markdown).toContain('# Debug text plan review');
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});
