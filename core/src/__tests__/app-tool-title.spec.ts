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

  it('reads the recipient from a result delivered as MCP text content', () => {
    const payload = JSON.stringify({ success: true, recipientId: 'agent-9aa3c508-709d-4a9d-b5b9-df0dfce513e2', recipientName: 'main' });
    const to = 'agent-9aa3c508-709d-4a9d-b5b9-df0dfce513e2';

    expect(title('send-message', { to }, 'completed', [{ type: 'text', text: payload }])).toBe('Sent message to main');
    expect(title('send-message', { to }, 'completed', { content: [{ type: 'text', text: payload }] })).toBe('Sent message to main');
    expect(title('send-message', { to }, 'completed', payload)).toBe('Sent message to main');
    expect(title('send-message', { to }, 'completed', [{ type: 'text', text: 'not json' }])).toBe('Sent message to other agent');
  });

  it('resolves a labelled agent id and never shows a raw id when no name is known', () => {
    const id = 'agent-9aa3c508-709d-4a9d-b5b9-df0dfce513e2';
    const roster = (identifier: string) => identifier === id ? 'Dina' : undefined;

    expect(title('send-message', { to: `agent:${id}` }, 'running', undefined, roster)).toBe('Sending message to Dina');
    expect(title('send-message', { to: ` id: ${id} ` }, 'completed', undefined, roster)).toBe('Sent message to Dina');
    expect(title('send-message', { to: id }, 'completed')).toBe('Sent message to other agent');
    expect(title('send-message', { to: `agent:${id}` }, 'failed', undefined, () => undefined)).toBe('Failed sending message to other agent');
    expect(title('send-message', { to: 'computer-use' }, 'completed')).toBe('Sent message to computer-use');
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
