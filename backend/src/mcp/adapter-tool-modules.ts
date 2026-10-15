import { registerInAppBrowserTools, type InAppBrowserClient } from './browser-tools';
import { registerComputerUseTools, type ComputerUseClient } from './computer-use-tools';
import { registerReviewTools } from './review-tools';
import type { ReviewToolRegistry } from '../review/review-tool-registry';
import type { AppMcpToolModuleProvider } from './tool-modules';

export function createComputerUseToolModuleProvider(
  client: ComputerUseClient | undefined,
  enabled: () => boolean,
): AppMcpToolModuleProvider {
  return {
    id: 'computer-use',
    resolve: () => client && enabled() ? {
      id: 'computer-use',
      register: server => registerComputerUseTools(server, client),
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
