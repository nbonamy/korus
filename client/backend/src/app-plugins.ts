import { computerUsePlugin } from '@workspace/core/app-plugins';
import type { ProviderPluginSummary } from '@workspace/core/contracts';

/** A harness's own Computer Use plugins (Codex bundles two); Korus's replaces them. */
const nativeComputerUse = /computer[-_ ]?use/i;

/** The plugins to offer in the composer: the harness's own, minus its Computer Use, plus Korus's when it is on. */
export function composePluginCatalog(native: readonly ProviderPluginSummary[], options: { computerUse: boolean }): ProviderPluginSummary[] {
  return [
    ...native.filter(plugin => !nativeComputerUse.test(plugin.id) && !nativeComputerUse.test(plugin.name)),
    ...(options.computerUse ? [computerUsePlugin] : []),
  ];
}
