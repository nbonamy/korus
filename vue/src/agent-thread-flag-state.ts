import type { Agent, AppSnapshot, MainToRendererEvent } from '@workspace/core/contracts';
import { normalizeThreadFlags } from '@workspace/core/thread-flags';

export function createAgentThreadFlagState(options: { getSnapshot: () => AppSnapshot }) {
  const submissions = new Map<string, { flags: NonNullable<Agent['threadFlags']>; pending: boolean; cleared: boolean; replacement?: Agent['threadFlags'] }>();
  const signature = (flags: Agent['threadFlags']) => JSON.stringify(normalizeThreadFlags(flags ?? {}));

  function observe(event: MainToRendererEvent): void {
    if (event.type !== 'agent.updated' || !Object.hasOwn(event.payload, 'threadFlags')) return;
    const submission = submissions.get(event.agentId);
    if (!submission) return;
    const flags = event.payload.threadFlags ?? undefined;
    if (signature(flags) === '{}') {
      submission.cleared = true;
      submission.replacement = undefined;
    } else if (submission.cleared || signature(flags) !== signature(submission.flags)) {
      submission.cleared = true;
      submission.replacement = flags;
      if (!submission.pending) submissions.delete(event.agentId);
    }
  }

  function project(snapshot: AppSnapshot, updatedAgentId?: string): void {
    for (const [agentId, submission] of submissions) {
      if (updatedAgentId && updatedAgentId !== agentId) continue;
      const agent = snapshot.agents.find(candidate => candidate.id === agentId);
      if (!agent) { submissions.delete(agentId); continue; }
      if (submission.replacement) agent.threadFlags = submission.replacement;
      else if (signature(agent.threadFlags) === '{}') submission.cleared = true;
      else if (signature(agent.threadFlags) === signature(submission.flags)) delete agent.threadFlags;
      else {
        submission.cleared = true;
        submission.replacement = agent.threadFlags;
      }
      if (submission.cleared && !submission.pending) submissions.delete(agentId);
    }
  }

  async function submit(agentId: string, send: () => Promise<AppSnapshot>, adopt: (snapshot: AppSnapshot) => void): Promise<void> {
    const agent = options.getSnapshot().agents.find(candidate => candidate.id === agentId);
    const submission = agent?.threadFlags ? { flags: agent.threadFlags, pending: true, cleared: false } : undefined;
    if (submission) {
      submissions.set(agentId, submission);
      delete agent!.threadFlags;
    }
    try {
      adopt(await send());
      if (submission) {
        submission.pending = false;
        if (submission.cleared && submissions.get(agentId) === submission) submissions.delete(agentId);
      }
    } catch (error) {
      if (submission && submissions.get(agentId) === submission) {
        submissions.delete(agentId);
        const current = options.getSnapshot().agents.find(candidate => candidate.id === agentId);
        if (!submission.cleared && current && !current.threadFlags) current.threadFlags = submission.flags;
      }
      throw error;
    }
  }

  return { observe, project, submit };
}
