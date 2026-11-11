import type { HarnessProvider, ProviderCapabilities } from './contracts';
import { codexHarnessCapabilities as nativecodex, claudeHarnessCapabilities as nativeclaude, cursorHarnessCapabilities as nativecursor, antigravityHarnessCapabilities as nativeantigravity } from '@korus-dev/multi-agent-sdk/contracts';
export const codexProviderCapabilities: ProviderCapabilities = {
  ...nativecodex,
  conversationReplaceWithSummary: true,
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
export function defaultProviderCapabilities(provider: HarnessProvider): ProviderCapabilities {
  return providerCapabilities[provider];
}
