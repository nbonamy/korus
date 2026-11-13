import { h, type FunctionalComponent } from 'vue';
import type { HarnessChoice } from '@korus-dev/agent-ui-sdk';
import type { HarnessProvider } from '@workspace/core/contracts';
import { harnessProviders } from '@workspace/core/contracts/shared';
import { providerDisplayName } from '@workspace/core/provider-driver';
import ProviderIcon from './ProviderIcon.vue';

/** The providers as the SDK model picker's tabs, in a fixed order so they never jump under the pointer. */
export function harnessChoices(providers: readonly HarnessProvider[]): HarnessChoice[] {
  return harnessProviders.filter(provider => providers.includes(provider)).map(provider => ({
    id: provider,
    label: providerDisplayName(provider),
    icon: ((attrs: Record<string, unknown>) => h(ProviderIcon, { ...attrs, provider })) as FunctionalComponent,
  }));
}
