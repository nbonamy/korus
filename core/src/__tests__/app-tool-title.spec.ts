import { describe, expect, it } from 'vitest';
import { appToolTitle } from '../app-tool-title';

const title = (tool: string, args: Record<string, unknown>, phase: 'running' | 'completed' | 'failed', result?: unknown, resolveAgentName?: (id: string) => string | undefined) =>
  appToolTitle({ tool, args, result, phase, resolveAgentName });

describe('appToolTitle', () => {
  it('names the other agent of a message from the result, the roster or the request', () => {
    const roster = (id: string) => id === 'agent-1' ? 'Dina' : undefined;

    expect(title('send-message', { to: 'agent-1' }, 'completed', { structuredContent: { recipientName: 'Dina Smith' } })).toBe('Sent message to Dina Smith');
    expect(title('send-message', { to: 'agent-1' }, 'running', undefined, roster)).toBe('Sending message to Dina');
    expect(title('send-message', {}, 'failed')).toBe('Failed sending message to other agent');
  });

  it('names what the simulator and the other tools acted on', () => {
    expect(title('simulator', { action: 'attach' }, 'completed', { attachment: { device: { name: 'iPhone 17' } } })).toBe('Opened iPhone 17');
    expect(title('simulator', { action: 'tap' }, 'running')).toBe('Tapping simulator screen');
    expect(title('create-worktree', { branchName: 'feature/x' }, 'completed')).toBe('Created worktree feature/x');
    expect(title('browser-open', { url: 'https://example.com' }, 'running')).toBe('Opening https://example.com');
  });

  it('formats Computer Use itself', () => {
    expect(title('computer-use-click', { app: 'Safari', label: 'Submit' }, 'completed')).toBe('Clicked Submit in Safari');
  });
});
