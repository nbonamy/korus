export * from '@korus-dev/multi-agent-sdk/contracts/backend';
import type { BackendCapabilities as HarnessCapabilities, BackendRuntimeStatus as HarnessRuntimeStatus } from '@korus-dev/multi-agent-sdk/contracts/backend';

/** Product workflows are composed by Korus, independently of native primitives. */
export type BackendCapabilities = HarnessCapabilities & {
  codeReview?: boolean;
  planReview?: boolean;
  conversationShare?: boolean;
};
export type BackendRuntimeStatus = Omit<HarnessRuntimeStatus, 'capabilities'> & {
  capabilities?: Partial<BackendCapabilities>;
};
