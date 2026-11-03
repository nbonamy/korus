import { describe, expect, it } from 'vitest';
import {
  claudeBackendCapabilities,
  codexBackendCapabilities,
  defaultBackendCapabilities,
} from '../backend-capabilities';

describe('backend capabilities', () => {
  it('enables only the implemented Cursor interrupt capability', () => {
    expect(defaultBackendCapabilities('cursor')).toStrictEqual({
      codeReview: false, planReview: false, questions: false, plugins: false,
      conversationArchive: false, conversationResume: false, conversationReplaceWithSummary: false,
      remoteControl: false, attachments: false, models: false, skills: false,
      reasoningEffort: false, serviceTier: false, thinkingBudget: false, planMode: 'unsupported',
      goals: false, steerPrompt: false, interrupt: true, history: false, conversationFork: false,
      deleteTurn: false, editTurn: false, retryTurn: false, approvals: false,
      approvalPresets: [], permissionModes: [],
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
