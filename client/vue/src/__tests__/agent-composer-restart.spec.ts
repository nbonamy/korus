import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { createAgentComposerState } from '../agent-composer-state';
import { stubElectronTestWindow } from '../../tests/support/client';

it('keeps the explicitly selected model of the active agent when models load after a restart', async () => {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  snapshot.activeAgentId = agent.id;
  agent.provider = 'claude';
  agent.providerDefaults = { kind: 'claude', model: 'sonnet', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null };
  const model = (id: string, isDefault = false) => ({ id, model: id, displayName: id, ...(isDefault ? { isDefault } : {}) });
  stubElectronTestWindow({ app: { listProviderModels: vi.fn(async () => [model('default', true), model('opus'), model('sonnet')]) } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot });

  composer.configurationForAgent(agent.id);
  await composer.loadModels(agent.id);

  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('sonnet');
  expect(composer.selectedModelId.value).toBe('sonnet');
});


it('adopts restored backend settings over saved preferences while retaining unsent edits until native acknowledgment', async () => {
  const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
  agent.provider = 'codex'; agent.providerSession = { kind: 'codex', threadId: 'native' };
  agent.providerDefaults = { kind: 'codex', model: 'saved', reasoningEffort: 'high', userSelectedModel: true };
  stubElectronTestWindow({ app: { listProviderModels: async () => ['saved', 'native', 'draft'].map(id => ({ id, model: id, displayName: id, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high' as const, description: 'High' }] })) } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot, persistSelection: async () => {} });
  await composer.loadModels(agent.id);
  const settings = (model: string) => composer.handleMainEvent({ seq: 1, occurredAt: '', agentId: agent.id, provider: 'codex', type: 'conversation.settingsUpdated', payload: { settings: { model, reasoningEffort: 'high' } } });
  settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('native');
  composer.selectModelForAgent(agent.id, 'draft'); await Promise.resolve();
  settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('draft');
  settings('draft'); settings('native');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('native');
});

it('keeps the chosen model when the conversation reports the model it resolves to, even if the default resolves to the same one', async () => {
  const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
  snapshot.activeAgentId = agent.id; agent.provider = 'claude';
  agent.providerDefaults = { kind: 'claude', model: 'sonnet', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null };
  // Claude's catalog lists "default" first, and it resolves to the same model as "sonnet".
  const model = (id: string, resolvedModel: string) => ({ id, model: id, displayName: id, providerMetadata: { resolvedModel } });
  stubElectronTestWindow({ app: { listProviderModels: async () => [model('default', 'claude-sonnet-5-5'), model('opus', 'claude-opus-5-5'), model('sonnet', 'claude-sonnet-5-5')] } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot, persistSelection: async () => {} });
  await composer.loadModels(agent.id);
  const running = (model: string) => composer.handleMainEvent({ seq: 1, occurredAt: '', agentId: agent.id, provider: 'claude', type: 'conversation.settingsUpdated', payload: { settings: { model } } });
  running('claude-sonnet-5-5');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('sonnet');
  // A model the choice does not resolve to is a real change, and the first entry naming it is shown.
  running('claude-opus-5-5');
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('opus');
});

it('restores an explicit choice saved under the model it resolved to, not the default that resolves to the same model', async () => {
  const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
  snapshot.activeAgentId = agent.id; agent.provider = 'claude';
  // After a turn the agent's saved model is the one that ran, which no catalog entry has as its id.
  agent.providerDefaults = { kind: 'claude', model: 'claude-sonnet-5-5', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null };
  const model = (id: string, resolvedModel: string, isDefault = false) => ({ id, model: id, displayName: id, providerMetadata: { resolvedModel }, ...(isDefault ? { isDefault } : {}) });
  stubElectronTestWindow({ app: { listProviderModels: async () => [model('default', 'claude-sonnet-5-5', true), model('opus', 'claude-opus-5-5'), model('sonnet', 'claude-sonnet-5-5')] } });
  const composer = createAgentComposerState({ getSnapshot: () => snapshot, persistSelection: async () => {} });
  composer.configurationForAgent(agent.id);
  await composer.loadModels(agent.id);
  expect(composer.configurationForAgent(agent.id).selectedModelId).toBe('sonnet');
});
