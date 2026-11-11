/** Boolean capability flags the SDK reports for what a provider can do, beyond the product's own. */
export const operationCapabilityFlags = [
  'textGeneration', 'structuredOutput', 'imageGeneration', 'review', 'bankedResets', 'conversationDelete', 'conversationTitle', 'scopedExecution',
  'turnContinuation', 'conversationContent', 'turnHistory', 'conversationStorage', 'mcpRequiredServers', 'mcpAutoApproval',
] as const;

/** Whether a value is a slash command a harness reports in its capabilities. */
export function isProviderCommandSummary(value: unknown): value is import('./contracts').ProviderCommandSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const optionalText = (key: string) => command[key] === undefined || typeof command[key] === 'string';
  return typeof command.id === 'string' && typeof command.provider === 'string' && typeof command.name === 'string'
    && optionalText('displayName') && optionalText('description') && optionalText('slashName')
    && (command.submitOnSelect === undefined || typeof command.submitOnSelect === 'boolean');
}
