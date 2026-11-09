import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createAgentComposerState } from '../agent-composer-state';
import { stubElectronTestWindow } from '../../tests/support/client';

it('keeps the explicitly selected model of the active agent when models load after a restart', async () => {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  snapshot.activeAgentId = agent.id;
  agent.backend = 'claude';
  agent.backendDefaults = { kind: 'claude', model: 'sonnet', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null };
  const model = (id: string, isDefault = false) => ({ id, model: id, displayName: id, ...(isDefault ? { isDefault } : {}) });
  stubElectronTestWindow({ app: { listBackendModels: vi.fn(async () => [model('default', true), model('opus'), model('sonnet')]) } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot });

  composer.configurationForAgent(agent.id);
  await composer.loadModels(agent.id);

  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('sonnet');
  expect(composer.selectedModelId.value).toBe('sonnet');
});
