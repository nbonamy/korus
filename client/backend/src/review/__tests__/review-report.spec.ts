import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Agent } from '@workspace/core/contracts';
import type { CodeReviewSession } from '@workspace/core/code-review';
import { saveCodeReviewReport } from '../review-report';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'review-report-'));
  homes.push(home);
  const agent: Agent = {
    id: 'reviewer', name: 'Review', folder: '/repo', backend: 'claude',
    backendDefaults: { kind: 'claude', model: 'sonnet', reasoningEffort: 'high' },
    status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now',
  };
  const session: CodeReviewSession = {
    id: 'review-1', targetAgentId: 'owner', reviewerAgentId: agent.id,
    scope: { type: 'branch', baseRef: 'main' }, threadMode: 'independent', status: 'readyToFinish',
    activeRoundId: 'round-1', createdAt: 'start', updatedAt: 'end',
    automation: { enabled: true, state: 'completed', maxPriority: 'p2', maxRounds: 3, commits: ['abc123'] },
    rounds: [{ id: 'round-1', number: 1, status: 'completed', startedAt: 'start', completedAt: 'end',
      reviewerSession: { kind: 'claude', sessionId: 'native-session', transport: 'stdio' },
      summary: 'Authorization verified. ```',
      findings: [{ id: 'finding-1', roundId: 'round-1', priority: 'p1', title: 'Check ownership', body: 'Missing authorization.',
        decision: { state: 'selected', decidedAt: 'start' }, discussion: [],
        remediation: { state: 'fixed', completedAt: 'end', evidence: 'Authorization tests passed.' },
        createdAt: 'start', updatedAt: 'end' }],
    }],
  };
  return { home, agent, session };
}

describe('review reports', () => {
  it('retains a readable private report and the full review record after the agent is gone', async () => {
    const { home, agent, session } = await fixture();
    const file = await saveCodeReviewReport(home, agent, session);
    session.status = 'finished';
    await saveCodeReviewReport(home, agent, session);
    const report = await readFile(file, 'utf8');
    expect(file).toBe(path.join(home, 'reviews', 'review-1.md'));
    expect(report).toContain('Model: sonnet');
    expect(report).toContain('Effort: high');
    expect(report).toContain('Authorization verified.');
    expect(report).toContain('Verification: Authorization tests passed.');
    const record = JSON.parse(report.split('```json\n\n')[1]!.split('\n\n```')[0]!);
    expect(record).toEqual(session);
    expect(await readdir(path.dirname(file))).toEqual(['review-1.md']);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it('rejects traversal and surfaces storage failures without silently dropping the report', async () => {
    const { home, agent, session } = await fixture();
    await expect(saveCodeReviewReport(home, agent, { ...session, id: '../escape' })).rejects.toThrow('Invalid review report ID');
    expect(await readdir(home)).toEqual([]);
    await writeFile(path.join(home, 'reviews'), 'not a directory');
    await expect(saveCodeReviewReport(home, agent, session)).rejects.toThrow();
    expect(await readFile(path.join(home, 'reviews'), 'utf8')).toBe('not a directory');
  });
});
