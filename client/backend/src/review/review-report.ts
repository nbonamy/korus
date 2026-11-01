import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent } from '@workspace/core/contracts';
import type { CodeReviewSession } from '@workspace/core/code-review';

/** Save the app-owned review ledger, not a copy of the provider transcript. */
export async function saveCodeReviewReport(home: string, agent: Agent, session: CodeReviewSession): Promise<string> {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(session.id)) throw new Error('Invalid review report ID.');
  const directory = path.join(home, 'reviews');
  const file = path.join(directory, `${session.id}.md`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  const report = [
    '# Code review report',
    `Review: ${session.id}`,
    `Workspace: ${agent.folder ?? 'Unknown'}`,
    `Backend: ${agent.backend}`,
    `Model: ${agent.backendDefaults?.model ?? 'Provider default'}`,
    `Effort: ${agent.backendDefaults?.reasoningEffort ?? 'Provider default'}`,
    `Status: ${session.status}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    'Full conversations remain in the configured provider home. Session references are recorded below.',
    ...session.rounds.flatMap(round => [
      `## Round ${round.number}`,
      round.summary ?? 'No inspection summary recorded.',
      ...round.findings.flatMap(finding => [
        `### ${finding.priority.toUpperCase()} — ${finding.title}`,
        finding.body,
        `Decision: ${finding.decision.state}; remediation: ${finding.remediation.state}`,
        ...(finding.remediation.state === 'fixed' ? [`Verification: ${finding.remediation.evidence ?? 'Not recorded'}`] : []),
      ]),
    ]),
    '## Review record',
    'The complete app-owned record includes scope, round session references, decisions, discussions, verification evidence, and local commits.',
    '```json',
    JSON.stringify(session, null, 2).replace(/`/g, '\\u0060'),
    '```',
    '',
  ].join('\n\n');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, report, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}
