import { describe, expect, it } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { backendRequestTimeoutMs } from '../backend-request-timeout';

describe('backendRequestTimeoutMs', () => {
  it('uses the action-specific budget and reserves time for the remote hop', () => {
    expect(backendRequestTimeoutMs(backendMethods.missionDelete)).toBe(125_000);
    expect(backendRequestTimeoutMs(backendMethods.agentConversationReplaceWithSummary)).toBe(605_000);
    expect(backendRequestTimeoutMs(backendMethods.backendHealthGet)).toBe(15_000);
  });

  it('rejects methods without an explicit timeout policy', () => {
    expect(() => backendRequestTimeoutMs('new/action')).toThrow('No backend request timeout configured for new/action.');
  });
});
