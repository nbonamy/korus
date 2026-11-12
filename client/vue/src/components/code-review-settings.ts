import { inject, type InjectionKey } from 'vue';
import type { CodeReviewPreferences } from '@workspace/core/code-review';
import type { HarnessProvider, ProviderModelOption } from '@workspace/core/contracts';
import { appApi } from '../platform-api';

type ReviewSettingsContext = {
  preferences: () => CodeReviewPreferences | undefined;
  listModels: (agentId: string | null, provider: HarnessProvider) => Promise<ProviderModelOption[]>;
  switchToManual: (agentId: string, sessionId: string) => Promise<unknown>;
  stop: (agentId: string) => Promise<unknown>;
};

export const codeReviewSettingsKey: InjectionKey<ReviewSettingsContext> = Symbol('codeReviewSettings');

export function useCodeReviewSettings(): ReviewSettingsContext {
  return inject(codeReviewSettingsKey, {
    preferences: () => undefined,
    listModels: async (agentId, provider) => await appApi?.listProviderModels(agentId, provider) ?? [],
    switchToManual: async (agentId, sessionId) => {
      if (!appApi) throw new Error('Backend connection is unavailable.');
      return await appApi.switchCodeReviewToManual(agentId, sessionId);
    },
    stop: async agentId => {
      if (!appApi) throw new Error('Backend connection is unavailable.');
      return await appApi.interruptAgent(agentId);
    },
  });
}
