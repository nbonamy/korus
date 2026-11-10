import type { AgentBackend, BackendCapabilities } from './contracts';
import { codexBackendCapabilities as nativecodex, claudeBackendCapabilities as nativeclaude, cursorBackendCapabilities as nativecursor, antigravityBackendCapabilities as nativeantigravity } from 'multi-agents-sdk';
export const codexBackendCapabilities: BackendCapabilities = {
  ...nativecodex,
  codeReview: true,
  planReview: true,
  conversationShare: true
};
export const claudeBackendCapabilities: BackendCapabilities = {
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
export const antigravityBackendCapabilities: BackendCapabilities = {
  ...nativeantigravity,
  codeReview: true,
  planReview: true,
  conversationShare: true,
  permissionModes: [
    { id: 'default', label: { key: 'permissions.antigravity.default.label' }, description: { key: 'permissions.antigravity.default.description' } },
    { id: 'auto_edit', label: { key: 'permissions.antigravity.autoEdit.label' }, description: { key: 'permissions.antigravity.autoEdit.description' } },
  ]
};
export const cursorBackendCapabilities: BackendCapabilities = {
  ...nativecursor,
  codeReview: true,
  planReview: true,
  conversationShare: false,
  permissionModes: [
    { id: 'default', label: { key: 'permissions.cursor.default.label' }, description: { key: 'permissions.cursor.default.description' } },
    { id: 'full-access', label: { key: 'permissions.cursor.fullAccess.label' }, description: { key: 'permissions.cursor.fullAccess.description' }, dangerous: true },
  ]
};
export function defaultBackendCapabilities(backend: AgentBackend): BackendCapabilities {
  if (backend === 'cursor') return cursorBackendCapabilities;
  if (backend === 'antigravity') return antigravityBackendCapabilities;
  return backend === 'claude' ? claudeBackendCapabilities : codexBackendCapabilities;
}
