import type { FeatureReporter } from "../telemetry/feature-reporter";
import { registerInAppBrowserTools, type InAppBrowserClient } from './browser-tools';
import { registerComputerUseTools, type ComputerUseClient } from './computer-use-tools';
import { registerReviewTools } from './review-tools';
import type { ReviewToolRegistry } from '../review/review-tool-registry';
import type { AppMcpToolModuleProvider } from './tool-modules';

export function createComputerUseToolModuleProvider(
  client: ComputerUseClient | undefined,
  enabled: () => boolean,
  featuresForAgent?: (agentId: string) => FeatureReporter,
): AppMcpToolModuleProvider {
  return {
    id: 'computer-use',
    resolve: ({ agentId }) => client && enabled() ? {
      id: 'computer-use',
      register: server => registerComputerUseTools(server, featuresForAgent ? {
        ...client,
        execute: input => featuresForAgent(agentId).track('computer.use', () => client.execute(input), result => {
          // Interpret only the helper's finite success discriminator; never its content/error text.
          if (!result || typeof result !== 'object' || !('ok' in result)) return 'unavailable';
          return result.ok === true ? 'succeeded' : result.ok === false ? 'failed' : 'unavailable';
        }),
      } : client),
    } : undefined,
  };
}

export function createBrowserToolModuleProvider(
  client: InAppBrowserClient | undefined,
): AppMcpToolModuleProvider {
  return {
    id: 'in-app-browser',
    resolve: ({ agentId }) => client ? {
      id: 'in-app-browser',
      register: server => registerInAppBrowserTools(server, agentId, client),
    } : undefined,
  };
}

export function createReviewToolModuleProvider(
  registry: ReviewToolRegistry | undefined,
): AppMcpToolModuleProvider {
  return {
    id: 'review',
    resolve: ({ agentId, url }) => {
      const context = registry?.resolve(agentId, url.searchParams.get('reviewContextId'));
      return context ? {
        id: 'review',
        register: server => registerReviewTools(server, context),
      } : undefined;
    },
  };
}
