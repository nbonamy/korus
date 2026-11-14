import type { HarnessProvider, ProviderCapabilities } from './contracts';
import type { ProviderConnection } from './contracts/provider-setup';
import { codexHarnessCapabilities as nativecodex, claudeHarnessCapabilities as nativeclaude, cursorHarnessCapabilities as nativecursor, antigravityHarnessCapabilities as nativeantigravity } from '@korus-dev/multi-agent-sdk/contracts';
export const codexProviderCapabilities: ProviderCapabilities = {
  ...nativecodex,
  personalInstructions: true,
  codeReview: true,
  planReview: true,
  conversationShare: true,
  permissionModes: [
    { id: 'ask-for-approval', label: { key: 'permissions.approval.ask.label' }, description: { key: 'permissions.approval.ask.description' } },
    { id: 'approve-for-me', label: { key: 'permissions.approval.automatic.label' }, description: { key: 'permissions.approval.automatic.description' } },
    { id: 'full-access', label: { key: 'permissions.approval.fullAccess.label' }, description: { key: 'permissions.approval.fullAccess.description' }, dangerous: true },
  ],
};
export const claudeProviderCapabilities: ProviderCapabilities = {
  ...nativeclaude,
  personalInstructions: true,
  codeReview: true,
  planReview: true,
  conversationShare: true,
  permissionModes: [
    {
      id: 'default',
      label: { key: 'permissions.claude.default.label' },
      description: { key: 'permissions.claude.default.description' },
    },
    {
      id: 'acceptEdits',
      label: { key: 'permissions.claude.acceptEdits.label' },
      description: { key: 'permissions.claude.acceptEdits.description' },
    },
    {
      id: 'dontAsk',
      label: { key: 'permissions.claude.dontAsk.label' },
      description: { key: 'permissions.claude.dontAsk.description' },
    },
    {
      id: 'auto',
      label: { key: 'permissions.claude.auto.label' },
      description: { key: 'permissions.claude.auto.description' },
    },
    {
      id: 'bypassPermissions',
      label: { key: 'permissions.claude.bypass.label' },
      description: { key: 'permissions.claude.bypass.description' },
      dangerous: true,
    },
  ]
};
export const antigravityProviderCapabilities: ProviderCapabilities = {
  ...nativeantigravity,
  personalInstructions: true,
  codeReview: true,
  planReview: true,
  conversationShare: true,
  permissionModes: [
    { id: 'default', label: { key: 'permissions.antigravity.default.label' }, description: { key: 'permissions.antigravity.default.description' } },
    { id: 'accept-edits', label: { key: 'permissions.antigravity.acceptEdits.label' }, description: { key: 'permissions.antigravity.acceptEdits.description' } },
    { id: 'auto', label: { key: 'permissions.antigravity.auto.label' }, description: { key: 'permissions.antigravity.auto.description' } },
  ]
};
export const cursorProviderCapabilities: ProviderCapabilities = {
  ...nativecursor,
  codeReview: true,
  planReview: true,
  conversationShare: false,
  permissionModes: [
    { id: 'default', label: { key: 'permissions.cursor.default.label' }, description: { key: 'permissions.cursor.default.description' } },
    { id: 'full-access', label: { key: 'permissions.cursor.fullAccess.label' }, description: { key: 'permissions.cursor.fullAccess.description' }, dangerous: true },
  ]
};
const providerCapabilities: Record<HarnessProvider, ProviderCapabilities> = {
  codex: codexProviderCapabilities, claude: claudeProviderCapabilities, cursor: cursorProviderCapabilities, antigravity: antigravityProviderCapabilities,
};
/** Where a conversation the agent switched away from is found again: archived on a harness that archives, otherwise still active. */
export function previousConversationStorage(provider: HarnessProvider): 'active' | 'archived' {
  return defaultProviderCapabilities(provider).conversationArchive ? 'archived' : 'active';
}
/**
 * Choices Korus makes for one harness that no capability explains. Each needs a reason; keep this list short.
 */
export const providerPolicy = {
  /** Cursor streams its thinking as long unstructured text, which crowds the pane's activity headings. */
  hideReasoning: new Set<HarnessProvider>(['cursor']),
} as const;
/** The account a connection signed in with, when its provider reports one. */
export function connectionAccount(authentication: ProviderConnection['authentication']): import('@korus-dev/multi-agent-sdk').Account | null {
  return authentication?.account ?? null;
}
/** Whether an account's quota is a subscription Korus can show; API-key accounts pay per use. */
export function supportsSubscriptionQuota(account?: import('@korus-dev/multi-agent-sdk').Account | null): boolean {
  return account?.kind !== 'apiKey';
}
/** The harness a new agent uses when nothing selects one. */
export const defaultHarnessProvider: HarnessProvider = 'codex';
export function defaultProviderCapabilities(provider: HarnessProvider): ProviderCapabilities {
  return providerCapabilities[provider];
}
