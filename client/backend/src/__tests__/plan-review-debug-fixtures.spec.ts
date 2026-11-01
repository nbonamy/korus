import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AppBackendServer } from '../server';
import { AppStateStore } from '../persistence/store';

it('injects diagrams in both Markdown review fixtures and preserves feedback across restart', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'markdown-plan-debug-'));
  const store = new AppStateStore(home);
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  agent.backendSession = { kind: 'codex', threadId: 'fixture-conversation' };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: next => store.save(next) });
  try {
    const inject = (format: 'text' | 'choices') => server.handleMessage({
      jsonrpc: '2.0', id: format, method: backendMethods.debugPlanReadyForReviewInject,
      params: { agentId: agent.id, format },
    });
    const published = await inject('choices');
    expect(published).not.toHaveProperty('error');
    const plan = snapshot.agents[0]!.planReview!;
    expect(plan.markdown).toContain('- (x)');
    expect(plan.markdown).toContain('- [x]');
    expect(plan.markdown).toMatch(/```mermaid\nflowchart [\s\S]+?\n```/u);
    const draft = { choices: [{ id: 's1-g0', quote: 'Platforms', selected: ['macOS'] }], comments: [{ id: 's0', sectionId: 's0', quote: 'Plan', body: 'Include cancellation.' }] };
    await server.handleMessage({ jsonrpc: '2.0', id: 'save', method: backendMethods.agentPlanReviewRespond,
      params: { agentId: agent.id, response: { resolution: 'save', reviewId: plan.id, draftVersion: 0, draft } },
    });
    const restored = await new AppStateStore(home).load();
    expect(restored.agents[0]!.planReview!.draft).toStrictEqual(draft);
    expect(restored.agents[0]!.planReview!.markdown).toBe(plan.markdown);
    expect(restored.agents[0]!.planReview!.status).toBe('pending');
    expect(snapshot.agents[1]!.planReview).toBeUndefined();
    await inject('text');
    const text = await new AppStateStore(home).load();
    expect(text.agents[0]!.planReview!.draft).toBeUndefined();
    expect(text.agents[0]!.planReview!.markdown).toContain('# Debug text plan review');
    expect(text.agents[0]!.planReview!.markdown).toMatch(/```mermaid\nflowchart [\s\S]+?\n```/u);
  } finally { await server.close(); await rm(home, { recursive: true, force: true }); }
});
