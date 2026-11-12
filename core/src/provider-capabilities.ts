import type { HarnessProvider, ProviderCapabilities } from './contracts';
import type { ProviderConnection } from './contracts/provider-setup';
import { codexHarnessCapabilities as nativecodex, claudeHarnessCapabilities as nativeclaude, cursorHarnessCapabilities as nativecursor, antigravityHarnessCapabilities as nativeantigravity } from '@korus-dev/multi-agent-sdk/contracts';
export const codexProviderCapabilities: ProviderCapabilities = {
  ...nativecodex,
  codeReview: true,
  planReview: true,
  conversationShare: true
};
export const claudeProviderCapabilities: ProviderCapabilities = {
  ...nativeclaude,
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
  codeReview: true,
  planReview: true,
  conversationShare: true,
  permissionModes: [
    { id: 'default', label: { key: 'permissions.antigravity.default.label' }, description: { key: 'permissions.antigravity.default.description' } },
    { id: 'auto_edit', label: { key: 'permissions.antigravity.autoEdit.label' }, description: { key: 'permissions.antigravity.autoEdit.description' } },
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
export function connectionAccount(authentication: ProviderConnection['authentication']): { type: string } | null {
  return authentication?.kind === 'codex' ? authentication.state.account : null;
}
/** Whether an account's quota is a subscription Korus can show; API-key accounts pay per use. */
export function supportsSubscriptionQuota(provider: HarnessProvider, account?: { type: string } | null): boolean {
  return provider !== 'codex' || account?.type !== 'apiKey';
}
/** The harness a new agent uses when nothing selects one. */
export const defaultHarnessProvider: HarnessProvider = 'codex';
export function defaultProviderCapabilities(provider: HarnessProvider): ProviderCapabilities {
  return providerCapabilities[provider];
}
