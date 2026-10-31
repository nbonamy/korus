import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { AgentThreadFlagService } from '../agent-thread-flag-service';
import { PROPOSED_WORK_DELEGATION_PROMPT } from '../worktree-delegation';
import { MISSION_COMMAND_PROMPT } from '../mission-command';

describe('AgentThreadFlagService', () => {
  it.each([
    [{ id: 'work_proposed', action: 'delegate' }, PROPOSED_WORK_DELEGATION_PROMPT],
    [{ id: 'work_proposed', action: 'create_mission' }, MISSION_COMMAND_PROMPT],
  ] as const)('accepts %j and clears only the proposal after submission', async (response, prompt) => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.threadFlags = { [response.id]: true, ready_for_review: true };
    const submit = vi.fn().mockResolvedValue(undefined);
    const service = new AgentThreadFlagService({ submit });

    await service.respond(agent, response);

    expect(submit).toHaveBeenCalledExactlyOnceWith(agent, prompt);
    expect(agent.threadFlags).toStrictEqual({ ready_for_review: true });
  });

  it.each(['delegate', 'create_mission'] as const)('preserves the proposal when %s fails and allows retry', async (action) => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.threadFlags = { work_proposed: true };
    const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const service = new AgentThreadFlagService({ submit });

    await expect(service.respond(agent, { id: 'work_proposed', action })).rejects.toThrow('offline');
    expect(agent.threadFlags).toStrictEqual({ work_proposed: true });
    await service.respond(agent, { id: 'work_proposed', action });
    expect(agent.threadFlags).toBeUndefined();
  });

  it('clears review readiness without submitting a conversation prompt', async () => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.threadFlags = { ready_for_review: true };
    const submit = vi.fn();
    const service = new AgentThreadFlagService({ submit });

    await service.respond(agent, { id: 'ready_for_review', action: 'execute' });

    expect(submit).not.toHaveBeenCalled();
    expect(agent.threadFlags).toBeUndefined();
  });

  it('dismisses without prompting and rejects stale or concurrent actions', async () => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.threadFlags = { work_proposed: true };
    let accept!: () => void;
    const submit = vi.fn(() => new Promise<void>((resolve) => { accept = resolve; }));
    const service = new AgentThreadFlagService({ submit });
    const pending = service.respond(agent, { id: 'work_proposed', action: 'delegate' });
    await expect(service.respond(agent, { id: 'work_proposed', action: 'create_mission' })).rejects.toThrow('already being handled');
    accept();
    await pending;
    await expect(service.respond(agent, { id: 'work_proposed', action: 'dismiss' })).rejects.toThrow('no longer active');

    agent.threadFlags = { work_proposed: true };
    await service.respond(agent, { id: 'work_proposed', action: 'dismiss' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([['work_proposed', 'invent-ui'], ['ready_for_review', 'create_mission']] as const)('rejects invalid %s / %s actions', async (id, action) => {
    const agent = createInitialSnapshot().agents[0]!;
    agent.threadFlags = { [id]: true };
    const service = new AgentThreadFlagService({ submit: vi.fn() });

    await expect(service.respond(agent, {
      id, action,
    } as never)).rejects.toThrow('Invalid thread flag action');
  });
});
