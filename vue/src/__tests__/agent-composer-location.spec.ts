import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createAgentComposerState } from '../agent-composer-state';
import { stubElectronTestWindow } from '../test/client';

describe('composer catalog locations', () => {
  it('uses background agent model settings for its next prompt without changing the main agent', async () => {
    const snapshot = createInitialSnapshot();
    const hostId = snapshot.agents[0]!.id;
    const guestId = snapshot.agents[1]!.id;
    snapshot.activeAgentId = hostId;
    const model = (id: string) => ({
      id, model: id, displayName: id, isDefault: id.endsWith('default'),
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }, { reasoningEffort: 'high', description: 'High' }],
    });
    stubElectronTestWindow({ app: {
      listBackendModels: vi.fn(async () => [model('shared-default'), model('guest-high')]),
    } });
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    await composer.loadModels(hostId);
    await composer.loadModels(guestId);
    const originalHostModel = composer.selectedModelId.value;

    composer.selectModelForAgent(guestId, 'guest-high');
    composer.selectReasoningEffortForAgent(guestId, 'high');

    expect(composer.selectedModelId.value).toBe(originalHostModel);
    expect(composer.resolvePromptOptions(guestId, 'review this')).toMatchObject({ model: 'guest-high', reasoningEffort: 'high' });
    expect(composer.resolvePromptOptions(hostId, 'continue')).toMatchObject({ model: 'shared-default' });
  });

  it('keeps a fresh backend switch isolated from an outstanding old-provider catalog', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    snapshot.activeAgentId = agent.id;
    const model = (id: string) => ({ id, model: id, displayName: id, isDefault: true });
    let finishCodex!: (models: ReturnType<typeof model>[]) => void;
    const oldModels = new Promise<ReturnType<typeof model>[]>(resolve => { finishCodex = resolve; });
    stubElectronTestWindow({ app: {
      listBackendModels: vi.fn(() => agent.backend === 'codex' ? oldModels : Promise.resolve([model('sonnet')])),
    } });
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    const oldLoad = composer.loadModels(agent.id);
    agent.backend = 'claude';
    agent.backendDefaults = { kind: 'claude' };
    composer.synchronizeAgentSelection(agent.id);
    await composer.loadModels(agent.id);
    expect(composer.selectedModelId.value).toBe('sonnet');
    finishCodex([model('codex-model')]);
    await oldLoad;
    expect(composer.backendModels.value.map(item => item.id)).toStrictEqual(['sonnet']);
    expect(composer.resolvePromptOptions(agent.id, 'hello')?.model).toBe('sonnet');
  });
  it('keeps local and SSH models separate, including pushed catalog updates', async () => {
    const snapshot = createInitialSnapshot();
    const local = snapshot.agents[0]!;
    const remote = snapshot.agents[1]!;
    remote.teamId = 'remote-team';
    remote.folder = local.folder;
    remote.remoteConnectionId = 'ssh-devbox';
    snapshot.teams.push({ id: remote.teamId, name: 'Remote', agentIds: [remote.id] });
    const model = (id: string) => ({ id, model: id, displayName: id, isDefault: true });
    const listBackendModels = vi.fn(async (id: string) => [model(id === local.id ? 'local-model' : 'remote-model')]);
    stubElectronTestWindow({ app: { listBackendModels } });
    const composer = createAgentComposerState({ getSnapshot: () => snapshot });
    snapshot.activeAgentId = local.id;
    await composer.loadModels(local.id);
    snapshot.activeAgentId = remote.id;
    composer.restore(remote.id);
    await composer.loadModels(remote.id);
    expect(listBackendModels).toHaveBeenCalledTimes(2);
    expect(composer.resolvePromptOptions(remote.id, 'hello')?.model).toBe('remote-model');

    composer.handleMainEvent({ type: 'models.changed', backend: 'codex', seq: 1, occurredAt: '', payload: { models: [model('local-updated')] } });
    expect(composer.selectedModelId.value).toBe('remote-model');
    composer.handleMainEvent({ type: 'models.changed', backend: 'codex', agentId: remote.id, seq: 2, occurredAt: '', payload: { models: [model('remote-updated')] } });
    expect(composer.selectedModelId.value).toBe('remote-updated');
    snapshot.activeAgentId = local.id;
    composer.restore(local.id);
    expect(composer.selectedModelId.value).toBe('local-updated');
  });
});
