/** Boolean capability flags the SDK reports for what a provider can do, beyond the product's own. */
export const operationCapabilityFlags = [
  'textGeneration', 'structuredOutput', 'imageGeneration', 'review', 'bankedResets', 'conversationDelete', 'conversationTitle', 'scopedExecution',
] as const;
