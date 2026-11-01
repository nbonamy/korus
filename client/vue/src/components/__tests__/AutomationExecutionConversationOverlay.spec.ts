import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { RendererMessage } from '@workspace/core/contracts';
import AutomationExecutionConversationOverlay from '../AutomationExecutionConversationOverlay.vue';

const messages: RendererMessage[] = [{
  id: 'message-user',
  agentId: 'agent-dina',
  role: 'user',
  status: 'complete',
  createdAt: '2026-06-09T10:00:02.000Z',
  parts: [{ type: 'text', text: 'Please fix the cockpit issue.' }],
}, {
  id: 'message-assistant',
  agentId: 'agent-dina',
  role: 'assistant',
  status: 'complete',
  createdAt: '2026-06-09T10:00:45.000Z',
  parts: [{ type: 'text', text: 'The cockpit issue is fixed.' }],
}];

describe('AutomationExecutionConversationOverlay', () => {
  it('renders the execution transcript and emits close', async () => {
    const wrapper = mount(AutomationExecutionConversationOverlay, {
      props: {
        agentName: 'Dina',
        messages,
        ticket: 'github:nbonamy/agent-workspace#12',
      },
    });

    expect(wrapper.attributes('role')).toBe('dialog');
    expect(wrapper.find('.automation-execution-conversation-overlay__scrim').exists()).toBe(true);
    expect(wrapper.text()).toContain('github:nbonamy/agent-workspace#12');
    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.text()).toContain('Please fix the cockpit issue.');
    expect(wrapper.text()).toContain('The cockpit issue is fixed.');

    await wrapper.get('[aria-label="Close conversation preview"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('shows useful tool activity but hides housekeeping calls in execution transcripts', () => {
    const wrapper = mount(AutomationExecutionConversationOverlay, {
      props: {
        agentName: 'Dina',
        messages: [{
          id: 'message-tool',
          agentId: 'agent-dina',
          role: 'assistant',
          status: 'complete',
          createdAt: '2026-06-09T10:00:45.000Z',
          parts: [{
            type: 'tool',
            id: 'browser-screenshot',
            kind: 'mcp',
            title: 'workspace.browser-screenshot',
            status: 'completed',
            metadata: { server: 'workspace', tool: 'browser-screenshot' },
          }, {
            type: 'tool',
            id: 'set-status',
            kind: 'mcp',
            title: 'workspace.set-status',
            status: 'completed',
            metadata: { server: 'workspace', tool: 'set-status' },
          }, {
            type: 'tool',
            id: 'finish-turn',
            kind: 'mcp',
            title: 'workspace.finish_turn',
            status: 'completed',
            metadata: { server: 'workspace', tool: 'finish_turn' },
          }],
        }],
        ticket: 'github:nbonamy/agent-workspace#12',
      },
    });

    expect(wrapper.text()).toContain('Captured page screenshot');
    expect(wrapper.find('.tabler-icon-browser').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Updated status');
    expect(wrapper.text()).not.toContain('Finished turn');
  });
});
