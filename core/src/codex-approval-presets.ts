import type { ApprovalPreset, ProviderDefaults } from './contracts';
import {
  approvalProviderDefaultsWithPreset,
  approvalPresetFromDefaults,
  defaultApprovalPreset,
  isApprovalPreset,
  isApprovalsReviewer,
} from './approval-presets';

export const defaultCodexApprovalPreset = defaultApprovalPreset;
export const isCodexApprovalPreset = isApprovalPreset;
export const isCodexApprovalsReviewer = isApprovalsReviewer;
export const codexApprovalPresetFromDefaults = approvalPresetFromDefaults;
export const codexProviderDefaultsWithApprovalPreset = approvalProviderDefaultsWithPreset;

export function codexApprovalPresetFromThreadSettings(threadSettings: unknown): ApprovalPreset | null {
  if (!isRecord(threadSettings)) {
    return null;
  }

  const approvalPolicy = threadSettings.approvalPolicy;
  const approvalsReviewer = threadSettings.approvalsReviewer;
  const sandboxPolicy = threadSettings.sandboxPolicy;
  const activePermissionProfile = threadSettings.activePermissionProfile;

  if (
    approvalPolicy === 'never' &&
    (
      (isRecord(sandboxPolicy) && sandboxPolicy.type === 'dangerFullAccess') ||
      (isRecord(activePermissionProfile) && activePermissionProfile.id === ':danger-no-sandbox')
    )
  ) {
    return 'full-access';
  }

  if (approvalPolicy === 'on-request' && approvalsReviewer === 'auto_review') {
    return 'approve-for-me';
  }

  if (approvalPolicy === 'on-request' && approvalsReviewer === 'user') {
    return 'ask-for-approval';
  }

  return null;
}

export type { ApprovalPreset, ProviderDefaults };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
