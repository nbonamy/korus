import { describe, expect, it, vi } from 'vitest';
import { createAgentFromInput } from '@workspace/core/agent-manager';
import type { SourceRepository } from '@workspace/core/contracts';
import { ProjectCreationService } from '../project-creation-service';

const repository: SourceRepository = {
  name: 'new-product',
  path: '/src/new-product',
  worktrees: [],
};

describe('ProjectCreationService', () => {
  it('creates the project folder and agent before submitting the handoff prompt', async () => {
    const steps: string[] = [];
    const agent = createAgentFromInput({ name: null, folder: repository.path, teamId: 'team-one', selection: { backend: 'codex' } });
    const service = new ProjectCreationService({
      createRepository: vi.fn(async () => { steps.push('repository'); return repository; }),
      createAgent: vi.fn(async () => { steps.push('agent'); return agent; }),
      startAgent: vi.fn(async () => { steps.push('prompt'); }),
    });

    await expect(service.create({ name: ' new-product ', teamId: 'team-one', prompt: ' Build it. ' }, progress => {
      steps.push(progress.state === 'running' ? progress.phase! : progress.state);
    })).resolves.toStrictEqual({
      repository, agent, promptSubmitted: true,
    });
    expect(steps).toStrictEqual(['creatingProject', 'repository', 'creatingAgent', 'agent', 'startingPrompt', 'prompt', 'success']);
  });

  it('reports the recoverable project folder when agent creation fails', async () => {
    const createRepository = vi.fn().mockResolvedValue(repository);
    const startAgent = vi.fn();
    const onProgress = vi.fn();
    const service = new ProjectCreationService({
      createRepository,
      createAgent: vi.fn().mockRejectedValue(new Error('Agent unavailable')),
      startAgent,
    });

    await expect(service.create({ name: 'new-product', teamId: 'team-one' }, onProgress))
      .rejects.toThrow('Created the project folder at /src/new-product, but could not finish setting up its agent. The folder remains on disk; check the agent list before retrying. Agent unavailable');
    expect(createRepository).toHaveBeenCalledOnce();
    expect(startAgent).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', phase: 'creatingAgent', error: expect.stringContaining(repository.path) }));
  });

  it('keeps an already created project recoverable when its initial prompt fails', async () => {
    const agent = createAgentFromInput({ name: null, folder: repository.path, teamId: 'team-one', selection: { backend: 'codex' } });
    const service = new ProjectCreationService({
      createRepository: vi.fn().mockResolvedValue(repository),
      createAgent: vi.fn().mockResolvedValue(agent),
      startAgent: vi.fn().mockRejectedValue(new Error('Backend offline')),
    });

    await expect(service.create({ name: 'new-product', teamId: 'team-one', prompt: 'Build it.' }))
      .rejects.toThrow('Created the project at /src/new-product, but could not start its agent. The project remains available. Backend offline');
  });
});
