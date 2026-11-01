import type { BackendModelOption, ModelFavorite } from '@workspace/core/contracts';

export function copyModelFavorite(favorite: ModelFavorite): ModelFavorite {
  return {
    backend: favorite.backend,
    modelId: favorite.modelId,
    reasoningEffort: favorite.reasoningEffort,
    serviceTier: favorite.serviceTier === 'default' ? null : favorite.serviceTier,
  };
}

export function modelFavoriteKey(favorite: ModelFavorite): string {
  return encodeURIComponent(JSON.stringify([
    favorite.backend,
    favorite.modelId,
    favorite.reasoningEffort,
    favorite.serviceTier,
  ]));
}

export function sameModelFavorite(left: ModelFavorite, right: ModelFavorite): boolean {
  return modelFavoriteKey(left) === modelFavoriteKey(right);
}

export function modelFavoriteModelLabel(
  favorite: ModelFavorite,
  models: readonly BackendModelOption[],
): string {
  return models.find((model) => model.id === favorite.modelId)?.displayName ?? favorite.modelId;
}

export function modelFavoriteSettingsLabel(
  favorite: ModelFavorite,
  models: readonly BackendModelOption[],
  standardSpeedLabel: string,
): string {
  const effort = favorite.reasoningEffort ? formatModelSettingLabel(favorite.reasoningEffort) : '';
  const tier = favorite.serviceTier && favorite.serviceTier !== 'default'
    ? modelFavoriteServiceTierLabel(favorite, models)
    : standardSpeedLabel;
  return [effort, tier].filter(Boolean).join(' · ');
}

export function modelFavoriteEffortLabel(favorite: ModelFavorite): string {
  return favorite.reasoningEffort ? formatModelSettingLabel(favorite.reasoningEffort) : '';
}

export function modelFavoriteServiceTierLabel(
  favorite: ModelFavorite,
  models: readonly BackendModelOption[],
): string {
  if (!favorite.serviceTier) return '';
  return models
    .find((model) => model.id === favorite.modelId)
    ?.serviceTiers?.find((candidate) => candidate.id === favorite.serviceTier)?.name
    ?? formatModelSettingLabel(favorite.serviceTier);
}

export function modelFavoriteFastTierLabel(
  favorite: ModelFavorite,
  models: readonly BackendModelOption[],
): string {
  if (!favorite.serviceTier || favorite.serviceTier === 'default') return '';
  return models
    .find((model) => model.id === favorite.modelId)
    ?.serviceTiers?.find((candidate) => candidate.id === favorite.serviceTier)?.name
    ?? '';
}

function formatModelSettingLabel(value: string): string {
  if (value.trim().toLowerCase() === 'xhigh') return 'Extra High';
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
