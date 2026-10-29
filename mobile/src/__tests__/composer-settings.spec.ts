import { describe, expect, it } from 'vitest';
import type { Agent, BackendModelOption } from '@workspace/core/contracts';
import { applyComposerChoice, promptOptionsFor, resolveComposerSettings } from '../composer-settings';

const models: BackendModelOption[] = [
  { id: 'gpt-fast', model: 'gpt-fast', displayName: 'Fast', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' }],
    serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }], defaultServiceTier: null },
  { id: 'gpt-deep', model: 'gpt-deep-0914', displayName: 'Deep', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] },
];
const agent = (patch: Partial<Agent> = {}): Agent => ({ id: 'a', name: null, folder: null, backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '', ...patch });

describe('phone composer settings', () => {
  it('starts from the agent\'s saved choice, then the provider default', () => {
    expect(resolveComposerSettings(agent({ backendDefaults: { kind: 'codex', model: 'gpt-deep-0914', reasoningEffort: 'high' } }), models, undefined))
      .toMatchObject({ model: { id: 'gpt-deep' }, reasoningEffort: 'high', serviceTier: null, planMode: false });
    expect(resolveComposerSettings(agent(), models, undefined)).toMatchObject({ model: { id: 'gpt-fast' }, reasoningEffort: 'medium' });
    expect(resolveComposerSettings(agent(), [], undefined)).toMatchObject({ model: null, reasoningEffort: null });
    expect(resolveComposerSettings(agent({ backend: 'claude', backendDefaults: { kind: 'claude', model: 'opus', serviceTier: 'fast' } }), [{ id: 'opus', model: 'opus', displayName: 'Opus' }], undefined).serviceTier).toBe('fast');
  });
  it('switching model adopts that model\'s own effort and tier defaults', () => {
    const next = applyComposerChoice('codex', models, { model: 'gpt-fast', reasoningEffort: 'low', serviceTier: 'priority', planMode: true }, { modelId: 'gpt-deep' });
    expect(next.choice).toStrictEqual({ model: 'gpt-deep-0914', reasoningEffort: 'high', serviceTier: null, planMode: true });
    expect(next.save).toStrictEqual({backend: 'codex',  model: 'gpt-deep-0914', reasoningEffort: 'high', serviceTier: null });
  });
  it('ignores an effort or tier the current model does not offer and keeps plan mode local', () => {
    const current = { model: 'gpt-fast', reasoningEffort: 'medium', serviceTier: null, planMode: false };
    expect(applyComposerChoice('codex', models, current, { reasoningEffort: 'high' }).choice).toStrictEqual(current);
    expect(applyComposerChoice('codex', models, current, { reasoningEffort: 'low' }).save).toStrictEqual({backend: 'codex',  model: 'gpt-fast', reasoningEffort: 'low', serviceTier: null });
    expect(applyComposerChoice('codex', models, current, { serviceTier: 'priority' }).choice.serviceTier).toBe('priority');
    expect(applyComposerChoice('codex', models, current, { serviceTier: 'bogus' }).choice).toStrictEqual(current);
    const plan = applyComposerChoice('codex', models, current, { planMode: true });
    expect(plan.choice.planMode).toBe(true); expect(plan.save).toBeNull();
  });
  it('sends the same prompt options as the desktop composer', () => {
    const settings = resolveComposerSettings(agent(), models, { model: 'gpt-fast', reasoningEffort: 'low', serviceTier: 'priority', planMode: true });
    expect(promptOptionsFor(settings, { models: true, reasoningEffort: true, serviceTier: true, planMode: 'native' }))
      .toStrictEqual({ planMode: true, selection: { model: 'gpt-fast', reasoningEffort: 'low', serviceTier: 'priority' } });
    expect(promptOptionsFor(settings, { models: true, reasoningEffort: false, serviceTier: false, planMode: 'prompted' })).toStrictEqual({ planMode: true, selection: { model: 'gpt-fast' } });
    expect(promptOptionsFor(resolveComposerSettings(agent(), models, { planMode: false }), { models: true, reasoningEffort: false, serviceTier: false, planMode: 'prompted' })).toStrictEqual({ selection: { model: 'gpt-fast' } });
    expect(promptOptionsFor(resolveComposerSettings(agent(), [], undefined), { models: true, reasoningEffort: true, serviceTier: true, planMode: 'unsupported' })).toBeUndefined();
  });
});
