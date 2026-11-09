import { describe, expect, it } from 'vitest';
import {
  claudeBackendCapabilities,
  codexBackendCapabilities,
  defaultBackendCapabilities,
} from '../backend-capabilities';

describe('backend capabilities', () => {
  it('enables implemented Cursor execution and cold history controls', () => {
    expect(defaultBackendCapabilities('cursor')).toStrictEqual({
      codeReview: true, planReview: true, questions: false, plugins: false,
      conversationArchive: false, conversationResume: true, conversationReplaceWithSummary: false,
      remoteControl: false, conversationShare: false, attachments: true, models: true, skills: false,
      reasoningEffort: true, serviceTier: false, thinkingBudget: false, planMode: 'native',
      goals: false, steerPrompt: false, interrupt: true, history: true, conversationFork: false,
      deleteTurn: false, editTurn: false, retryTurn: false, approvals: false,
      approvalPresets: [], permissionModes: [
        { id: 'default', label: { key: 'permissions.cursor.default.label' }, description: { key: 'permissions.cursor.default.description' } },
        { id: 'full-access', label: { key: 'permissions.cursor.fullAccess.label' }, description: { key: 'permissions.cursor.fullAccess.description' }, dangerous: true },
      ],
    });
  });
  it('never inherits unsupported Codex controls for Antigravity', () => {
    expect(defaultBackendCapabilities('antigravity')).toMatchObject({
      goals: false, serviceTier: false, thinkingBudget: false, reasoningEffort: false,
      steerPrompt: false, conversationFork: false, deleteTurn: false, editTurn: false,
      retryTurn: false, plugins: false, remoteControl: false,
      conversationArchive: false, conversationReplaceWithSummary: false,
    });
  });
  it('returns the native Codex capability set', () => {
    expect(defaultBackendCapabilities('codex')).toBe(codexBackendCapabilities);
    expect(codexBackendCapabilities).toMatchObject({
      attachments: true,
      planMode: 'native',
      goals: true,
      serviceTier: true,
      steerPrompt: true,
      approvals: true,
      conversationFork: true,
    });
  });

  it('returns the prompted Claude capability set', () => {
    expect(defaultBackendCapabilities('claude')).toBe(claudeBackendCapabilities);
    expect(claudeBackendCapabilities).toMatchObject({
      attachments: true,
      planMode: 'prompted',
      goals: true,
      serviceTier: false,
      steerPrompt: true,
      approvals: true,
      conversationFork: true,
      approvalPresets: [],
      permissionModes: [
        expect.objectContaining({ id: 'default', label: { key: 'permissions.claude.default.label' } }),
        expect.objectContaining({ id: 'acceptEdits', label: { key: 'permissions.claude.acceptEdits.label' } }),
        expect.objectContaining({ id: 'dontAsk', label: { key: 'permissions.claude.dontAsk.label' } }),
        expect.objectContaining({ id: 'auto', label: { key: 'permissions.claude.auto.label' } }),
        expect.objectContaining({ id: 'bypassPermissions', dangerous: true }),
      ],
    });
  });
});
