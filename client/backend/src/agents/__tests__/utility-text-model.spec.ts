import { describe, expect, it } from 'vitest';
import type { ProviderModelOption } from '@workspace/core/contracts';
import { utilityTextModel } from '../utility-text-model';

const model = (id: string, extra: Partial<ProviderModelOption> = {}): ProviderModelOption => ({ id, model: id, displayName: id, isDefault: false, ...extra }) as ProviderModelOption;
const levels = (...ids: string[]) => ({ supportedReasoningEfforts: ids.map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })), defaultReasoningEffort: ids.at(-1) }) as Partial<ProviderModelOption>;

describe('utility text model', () => {
  it('picks the family meant for the task, at the thinking level that suits it', () => {
    const catalog = [model('opus'), model('sonnet', levels('low', 'medium', 'high')), model('haiku')];
    expect(utilityTextModel('claude', catalog, 'simple')).toStrictEqual({ model: 'haiku' });
    expect(utilityTextModel('claude', catalog, 'normal')).toStrictEqual({ model: 'sonnet', reasoningEffort: 'medium' });
    expect(utilityTextModel('claude', catalog, 'complex')).toStrictEqual({ model: 'opus' });
  });

  it('falls back to the nearest family the account offers, cheapest first', () => {
    // An account without the lightweight or the largest family still gets its background work done.
    const catalog = [model('claude-opus-4-6-thinking'), model('gemini-3.8-flash', { isDefault: true, ...levels('low', 'medium', 'high') }), model('gpt-oss-120b-medium')];
    expect(utilityTextModel('antigravity', catalog, 'simple')).toStrictEqual({ model: 'gemini-3.8-flash', reasoningEffort: 'low' });
    expect(utilityTextModel('antigravity', catalog, 'complex')).toStrictEqual({ model: 'gemini-3.8-flash', reasoningEffort: 'high' });
  });

  it('uses the account\'s default model when no known family is offered, and fails only on an empty catalog', () => {
    expect(utilityTextModel('antigravity', [model('gpt-oss-120b-medium'), model('house-model', { isDefault: true })], 'normal')).toStrictEqual({ model: 'house-model' });
    expect(utilityTextModel('codex', [model('only-one')], 'simple')).toStrictEqual({ model: 'only-one' });
    expect(() => utilityTextModel('claude', [], 'simple')).toThrow('No text model is available for claude. Refresh the provider\'s model catalog and try again.');
  });
});
