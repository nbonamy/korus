import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { conversationControllerActions, mountShell } from './app-shell-test-harness';
import type { CodeAnnotationInput } from '../use-code-annotations';

const annotation: CodeAnnotationInput = { path: 'src/billing.ts', startLine: 12, endLine: 14, side: 'new', text: '+const total = sum(items);\n+return total;', comment: 'Guard the empty cart.' };

describe('AppShell code annotations', () => {
  it('moves comments on code from the side panels into composer context and sends them with the next message', async () => {
    const snapshot = createInitialSnapshot();
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, realConversationPane: true, sendPromptAction });

    const panel = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    panel.vm.$emit('annotateCode', annotation);
    panel.vm.$emit('annotateCode', { path: 'src/cart.ts', startLine: 3, endLine: 3, text: 'let x;', comment: 'Name this.' });
    await flushPromises();
    expect(wrapper.findAll('.composer-context-cards__card')).toHaveLength(2);
    expect(wrapper.findAll('.composer-context-cards__label').map(label => label.text())).toEqual(['Code', 'Code']);
    expect(wrapper.findAll('.composer-context-cards__card').map(card => card.attributes('title'))).toEqual(['Guard the empty cart.', 'Name this.']);
    expect(wrapper.text()).toContain('billing.ts:12-14');
    expect(wrapper.text()).toContain('cart.ts:3');

    await conversationControllerActions(wrapper).submit?.('Fix them.', undefined);
    const prompt = String(sendPromptAction.mock.calls[0]?.[0]);
    expect(prompt).toContain('Code annotations:');
    expect(prompt).toContain('1. src/billing.ts lines 12-14');
    expect(prompt).toContain('> +const total = sum(items);');
    expect(prompt).toContain('Comment: Guard the empty cart.');
    expect(prompt).toContain('2. src/cart.ts line 3');
    expect(prompt).toContain('Fix them.');
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
  });

  it('lets a comment be taken back before it is sent', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot, realConversationPane: true });
    wrapper.getComponent({ name: 'RightWorkspacePanel' }).vm.$emit('annotateCode', annotation);
    await flushPromises();
    await wrapper.get('.composer-context-cards__remove').trigger('click');
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
  });
});
