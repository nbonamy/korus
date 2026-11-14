import type { ProviderPluginSummary } from './contracts/provider';

/** The id of the Computer Use plugin Korus lists for every harness, in place of any harness's own. */
export const computerUsePluginId = 'korus-computer-use';

/** Plugins Korus provides itself: the harness neither lists nor receives them natively. */
export function isAppPlugin(pluginId: string): boolean {
  return pluginId === computerUsePluginId;
}

export const computerUsePlugin: ProviderPluginSummary = {
  id: computerUsePluginId,
  name: 'computer-use',
  displayName: 'Computer Use',
  shortDescription: 'Control macOS apps',
  enabled: true,
};
