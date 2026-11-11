import type { AppTextDescriptor, ApprovalPreset, HarnessProvider, ProviderDefaults, CodexApprovalsReviewer } from './contracts';

export const defaultApprovalPreset: ApprovalPreset = 'full-access';

export type ApprovalPresetOption = {
  id: ApprovalPreset;
  label: AppTextDescriptor;
  description: AppTextDescriptor;
};

export const approvalPresetOptions: readonly ApprovalPresetOption[] = [
  {
    id: 'ask-for-approval',
    label: { key: 'permissions.approval.ask.label' },
    description: { key: 'permissions.approval.ask.description' },
  },
  {
    id: 'approve-for-me',
    label: { key: 'permissions.approval.automatic.label' },
    description: { key: 'permissions.approval.automatic.description' },
  },
  {
    id: 'full-access',
    label: { key: 'permissions.approval.fullAccess.label' },
    description: { key: 'permissions.approval.fullAccess.description' },
  },
] as const;

export function isApprovalPreset(value: unknown): value is ApprovalPreset {
  return value === 'ask-for-approval' || value === 'approve-for-me' || value === 'full-access';
}

export function isApprovalsReviewer(value: unknown): value is CodexApprovalsReviewer {
  return value === 'user' || value === 'auto_review' || value === 'guardian_subagent';
}

export function approvalPresetFromDefaults(defaults: ProviderDefaults | undefined): ApprovalPreset {
  if (defaults?.kind !== 'codex') {
    return defaultApprovalPreset;
  }

  if (isApprovalPreset(defaults.approvalPreset)) {
    return defaults.approvalPreset;
  }

  if (defaults.approvalPolicy === 'never' && defaults.sandboxMode === 'danger-full-access') {
    return 'full-access';
  }

  if (defaults.approvalPolicy === 'on-request' && (defaults.approvalsReviewer === 'auto_review' || defaults.approvalsReviewer === 'guardian_subagent')) {
    return 'approve-for-me';
  }

  if (defaults.approvalPolicy === 'on-request') {
    return 'ask-for-approval';
  }

  return defaultApprovalPreset;
}

export function approvalProviderDefaultsWithPreset(
  defaults: ProviderDefaults | undefined,
  preset: ApprovalPreset,
): Extract<ProviderDefaults, { kind: 'codex' }> {
  const base = defaults?.kind === 'codex' ? defaults : { kind: 'codex' as const };
  if (preset === 'full-access') {
    return {
      ...base,
      approvalPreset: preset,
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      approvalsReviewer: 'user',
    };
  }

  if (preset === 'approve-for-me') {
    return {
      ...base,
      approvalPreset: preset,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalsReviewer: 'auto_review',
    };
  }

  return {
    ...base,
    approvalPreset: preset,
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    approvalsReviewer: 'user',
  };
}

/** Stored defaults with a permission choice applied, in the shape the provider keeps it. */
export function providerDefaultsWithPermission(defaults: ProviderDefaults | undefined, provider: HarnessProvider, permission: string): ProviderDefaults {
  if (provider === 'codex') return isApprovalPreset(permission) ? approvalProviderDefaultsWithPreset(defaults, permission) : defaults?.kind === 'codex' ? defaults : { kind: 'codex' };
  return { ...(defaults?.kind === provider ? defaults : {}), kind: provider, permissionMode: permission } as ProviderDefaults;
}
