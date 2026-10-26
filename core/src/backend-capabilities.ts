import type { AgentBackend, BackendCapabilities } from './contracts';

export const codexBackendCapabilities: BackendCapabilities = {
  codeReview: true,
  planReview: true,
  questions: true,
  plugins: true,
  conversationArchive: true,
  conversationResume: true,
  conversationReplaceWithSummary: true,
  remoteControl: true,
  attachments: true,
  models: true,
  skills: true,
  reasoningEffort: true,
  serviceTier: true,
  thinkingBudget: false,
  planMode: 'native',
  goals: true,
  steerPrompt: true,
  interrupt: true,
  history: true,
  conversationFork: true,
  deleteTurn: true,
  editTurn: true,
  retryTurn: true,
  approvals: true,
  approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
};

export const claudeBackendCapabilities: BackendCapabilities = {
  codeReview: true,
  planReview: true,
  questions: true,
  plugins: false,
  conversationArchive: false,
  conversationResume: true,
  conversationReplaceWithSummary: false,
  remoteControl: false,
  attachments: true,
  models: true,
  skills: true,
  reasoningEffort: false,
  serviceTier: false,
  thinkingBudget: false,
  planMode: 'prompted',
  goals: true,
  steerPrompt: true,
  interrupt: true,
  history: true,
  conversationFork: true,
  deleteTurn: false,
  editTurn: false,
  retryTurn: false,
  approvals: true,
  approvalPresets: [],
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
  ],
};

export function defaultBackendCapabilities(backend: AgentBackend): BackendCapabilities {
  if (backend === 'antigravity') return antigravityBackendCapabilities;
  return backend === 'claude' ? claudeBackendCapabilities : codexBackendCapabilities;
}

// Keep unimplemented app workflows unavailable until their owning integration is qualified.
export const antigravityBackendCapabilities: BackendCapabilities = {
  codeReview: true, planReview: true, questions: true, plugins: false,
  conversationArchive: false, conversationResume: true, conversationReplaceWithSummary: false,
  remoteControl: false, attachments: true, models: true, skills: false,
  reasoningEffort: false, serviceTier: false, thinkingBudget: false,
  planMode: 'native', goals: false, steerPrompt: false, interrupt: true, history: true,
  conversationFork: false, deleteTurn: false, editTurn: false, retryTurn: false,
  approvals: true, approvalPresets: [],
  permissionModes: [
    { id: 'default', label: { key: 'permissions.antigravity.default.label' }, description: { key: 'permissions.antigravity.default.description' } },
    { id: 'auto_edit', label: { key: 'permissions.antigravity.autoEdit.label' }, description: { key: 'permissions.antigravity.autoEdit.description' } },
  ],
};
