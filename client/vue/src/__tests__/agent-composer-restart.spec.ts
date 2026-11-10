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


it('adopts restored backend settings over saved preferences while retaining unsent edits until native acknowledgment', async () => {
  const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
  agent.backend = 'codex'; agent.backendSession = { kind: 'codex', threadId: 'native' };
  agent.backendDefaults = { kind: 'codex', model: 'saved', reasoningEffort: 'high', userSelectedModel: true };
  stubElectronTestWindow({ app: { listBackendModels: async () => ['saved', 'native', 'draft'].map(id => ({ id, model: id, displayName: id, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' as const, description: 'High' }] })) } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot, persistSelection: async () => {} });
  await composer.loadModels(agent.id);
  const settings = (model: string) => composer.handleMainEvent({ seq: 1, occurredAt: '', agentId: agent.id, backend: 'codex', type: 'conversation.settingsUpdated', payload: { settings: { model, reasoningEffort: 'high' } } });
  settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('native');
  composer.selectModelForAgent(agent.id, 'draft'); await Promise.resolve();
  settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('draft');
  settings('draft'); settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('native');
});
