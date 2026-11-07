import type { BackendModelOption } from '@workspace/core/contracts';
import { record } from '../acp/acp-connection';

export function cursorModels(configuration: Record<string, unknown>): BackendModelOption[] {
  const config = Array.isArray(configuration.configOptions) ? configuration.configOptions.find(option => record(option) && option.category === 'model') : undefined;
  if (!record(config) || !Array.isArray(config.options)) return [];
  return config.options.flatMap(option => {
    if (!record(option) || typeof option.value !== 'string' || typeof option.name !== 'string') return [];
    return [{ id: option.value, model: option.value, displayName: option.name, isDefault: option.value === config.currentValue,
      ...(typeof option.description === 'string' ? { description: option.description } : {}) }];
  });
}
