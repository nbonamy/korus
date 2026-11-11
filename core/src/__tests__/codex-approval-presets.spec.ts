import { describe, expect, it } from 'vitest';
import type { ProviderDefaults } from '../contracts';
import {
  codexApprovalPresetFromDefaults,
  codexApprovalPresetFromThreadSettings,
  codexProviderDefaultsWithApprovalPreset,
  defaultCodexApprovalPreset,
  isCodexApprovalPreset,
  isCodexApprovalsReviewer,
} from '../codex-approval-presets';

describe('codex approval presets', () => {
  it('validates preset and reviewer values', () => {
    expect(isCodexApprovalPreset('ask-for-approval')).toBe(true);
    expect(isCodexApprovalPreset('approve-for-me')).toBe(true);
    expect(isCodexApprovalPreset('full-access')).toBe(true);
    expect(isCodexApprovalPreset('manual')).toBe(false);

    expect(isCodexApprovalsReviewer('user')).toBe(true);
    expect(isCodexApprovalsReviewer('auto_review')).toBe(true);
    expect(isCodexApprovalsReviewer('guardian_subagent')).toBe(true);
    expect(isCodexApprovalsReviewer('system')).toBe(false);
  });

  it('normalizes backend defaults into approval presets', () => {
    expect(codexApprovalPresetFromDefaults(undefined)).toBe(defaultCodexApprovalPreset);
    expect(codexApprovalPresetFromDefaults({ kind: 'claude' })).toBe(defaultCodexApprovalPreset);
    expect(codexApprovalPresetFromDefaults({
      kind: 'codex',
      approvalPreset: 'approve-for-me',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'workspace-write',
    })).toBe('approve-for-me');
    expect(codexApprovalPresetFromDefaults({
      kind: 'codex',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    })).toBe('full-access');
    expect(codexApprovalPresetFromDefaults({
      kind: 'codex',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    })).toBe('approve-for-me');
    expect(codexApprovalPresetFromDefaults({
      kind: 'codex',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    })).toBe('ask-for-approval');
    expect(codexApprovalPresetFromDefaults({
      kind: 'codex',
      approvalPolicy: 'on-failure',
      sandboxMode: 'workspace-write',
    })).toBe(defaultCodexApprovalPreset);
  });

  it('derives approval presets from app-server thread settings', () => {
    expect(codexApprovalPresetFromThreadSettings(null)).toBeNull();
    expect(codexApprovalPresetFromThreadSettings([])).toBeNull();
    expect(codexApprovalPresetFromThreadSettings({
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })).toBe('full-access');
    expect(codexApprovalPresetFromThreadSettings({
      approvalPolicy: 'never',
      activePermissionProfile: { id: ':danger-no-sandbox' },
    })).toBe('full-access');
    expect(codexApprovalPresetFromThreadSettings({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    })).toBe('approve-for-me');
    expect(codexApprovalPresetFromThreadSettings({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    })).toBe('ask-for-approval');
    expect(codexApprovalPresetFromThreadSettings({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'guardian_subagent',
    })).toBeNull();
  });

  it('writes presets back to codex backend defaults without losing existing defaults', () => {
    const defaults: ProviderDefaults = {
      kind: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'workspace-write',
    };

    expect(codexProviderDefaultsWithApprovalPreset(defaults, 'full-access')).toStrictEqual({
      kind: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
      approvalPreset: 'full-access',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
    });
    expect(codexProviderDefaultsWithApprovalPreset(undefined, 'approve-for-me')).toStrictEqual({
      kind: 'codex',
      approvalPreset: 'approve-for-me',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxMode: 'workspace-write',
    });
    expect(codexProviderDefaultsWithApprovalPreset({ kind: 'claude' }, 'ask-for-approval')).toStrictEqual({
      kind: 'codex',
      approvalPreset: 'ask-for-approval',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxMode: 'workspace-write',
    });
  });
});
