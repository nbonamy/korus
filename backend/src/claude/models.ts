import type { BackendModelOption } from '@workspace/core/contracts';
import type { ClaudeAvailableModel } from './transport';

export const claudeModelOptions: BackendModelOption[] = [
  {
    id: 'opus',
    model: 'opus',
    displayName: 'Opus',
  },
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Sonnet',
    isDefault: true,
  },
  {
    id: 'haiku',
    model: 'haiku',
    displayName: 'Haiku',
  },
];

export function claudeModelOptionsFromSdk(models: readonly ClaudeAvailableModel[]): BackendModelOption[] {
  return models
    .filter((model) => model.value.trim().length > 0)
    .map((model) => ({
      id: model.value,
      model: model.value,
      displayName: model.displayName || model.value,
      ...(model.description ? { description: model.description } : {}),
      ...(model.resolvedModel ? { providerMetadata: { resolvedModel: model.resolvedModel } } : {}),
      ...(model.supportsFastMode ? { serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Faster responses at extra cost; not included in subscription usage.' }], defaultServiceTier: null } : {}),
      ...(model.supportsEffort && model.supportedEffortLevels?.length
        ? {
            supportedReasoningEfforts: model.supportedEffortLevels.map((reasoningEffort) => ({
              reasoningEffort,
              description: claudeEffortDescription(reasoningEffort),
            })),
            defaultReasoningEffort: model.supportedEffortLevels.includes('high')
              ? 'high'
              : model.supportedEffortLevels[0],
          }
        : {}),
    }));
}

function claudeEffortDescription(effort: NonNullable<ClaudeAvailableModel['supportedEffortLevels']>[number]): string {
  return ({
    low: 'Minimal thinking for faster responses',
    medium: 'Moderate thinking',
    high: 'Deep reasoning',
    xhigh: 'Deeper reasoning',
    max: 'Maximum reasoning',
  })[effort];
}
