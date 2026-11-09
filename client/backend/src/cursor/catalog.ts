import type { BackendModelOption } from '@workspace/core/contracts';
import { record } from '../acp/acp-connection';

type ThoughtControl = {id:string;currentValue:string;options:{value:string;name:string}[]};
export type CursorCatalogModel = {value:string;name:string;configOptions:unknown[]};

/** Only the unique enum axis is reasoning effort; boolean thinking stays independent. */
export function cursorThoughtControl(options: unknown): ThoughtControl | null {
  if (!Array.isArray(options)) return null;
  const enums:ThoughtControl[]=[];
  for (const option of options) {
    if (!record(option) || option.category !== 'thought_level' || option.type !== 'select') continue;
    if (typeof option.id !== 'string' || !option.id || typeof option.currentValue !== 'string' || !Array.isArray(option.options) || !option.options.length || option.options.length > 100) throw new Error('Invalid Cursor reasoning catalog.');
    const values=option.options.map(value=>{
      if (!record(value) || typeof value.value !== 'string' || !value.value || typeof value.name !== 'string') throw new Error('Invalid Cursor reasoning option.');
      return {value:value.value,name:value.name};
    });
    if (new Set(values.map(value=>value.value)).size !== values.length || !values.some(value=>value.value===option.currentValue)) throw new Error('Invalid Cursor reasoning value.');
    if (!values.every(value=>value.value==='true' || value.value==='false')) enums.push({id:option.id,currentValue:option.currentValue,options:values});
  }
  return enums.length===1 ? enums[0]! : null;
}

export function cursorModelCatalog(result: unknown): CursorCatalogModel[] {
  if (!record(result) || !Array.isArray(result.models) || result.models.length > 1000) throw new Error('Invalid Cursor model catalog.');
  const models=result.models.map(model=>{
    if (!record(model) || typeof model.value !== 'string' || !model.value || typeof model.name !== 'string' || !Array.isArray(model.configOptions) || model.configOptions.length > 100) throw new Error('Invalid Cursor model catalog entry.');
    cursorThoughtControl(model.configOptions);
    return {value:model.value,name:model.name,configOptions:structuredClone(model.configOptions)};
  });
  if (new Set(models.map(model=>model.value)).size!==models.length) throw new Error('Duplicate Cursor model identity.');
  return models;
}

/** Native selected label only: this is capacity metadata, never observed usage. */
function contextLabel(options: unknown): string | null {
  if (!Array.isArray(options)) return null;
  const candidates = options.filter(option => record(option) && option.id === 'context');
  if (candidates.length !== 1) return null;
  const context = candidates[0];
  if (!record(context) || context.category !== 'model_config' || context.type !== 'select'
    || typeof context.currentValue !== 'string' || !context.currentValue
    || !Array.isArray(context.options) || !context.options.length || context.options.length > 100) return null;
  const choices = context.options;
  if (!choices.every(choice => record(choice) && typeof choice.value === 'string' && choice.value.length > 0
    && typeof choice.name === 'string' && choice.name.trim().length > 0 && choice.name.length <= 200
    && !/[\p{Cc}\p{Cf}]/u.test(choice.name))) return null;
  if (new Set(choices.map(choice => choice.value)).size !== choices.length) return null;
  const selected = choices.find(choice => choice.value === context.currentValue);
  return selected ? selected.name : null;
}

export function cursorModels(configuration: Record<string, unknown>, catalog?: readonly CursorCatalogModel[]): BackendModelOption[] {
  const config = Array.isArray(configuration.configOptions) ? configuration.configOptions.find(option => record(option) && option.category === 'model') : undefined;
  if (!record(config) || !Array.isArray(config.options)) return [];
  return config.options.flatMap(option => {
    if (!record(option) || typeof option.value !== 'string' || typeof option.name !== 'string') return [];
    const modelOptions = option.value===config.currentValue ? configuration.configOptions : catalog?.find(model=>model.value===option.value)?.configOptions;
    const thought=cursorThoughtControl(modelOptions);
    const context = contextLabel(modelOptions);
    const description = context === null ? option.description : [option.description, `Context: ${context}`].filter(value => typeof value === 'string' && value.length > 0).join(' · ');
    return [{ id: option.value, model: option.value, displayName: option.name, isDefault: option.value === config.currentValue,
      ...(typeof description === 'string' ? { description } : {}),
      ...(thought ? {supportedReasoningEfforts:thought.options.map(value=>({reasoningEffort:value.value,description:value.name})),defaultReasoningEffort:thought.currentValue} : {}),
    }];
  });
}
