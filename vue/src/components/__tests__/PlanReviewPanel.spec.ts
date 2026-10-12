import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessageBox } from 'element-plus';
import PlanReviewPanel from '../PlanReviewPanel.vue';

afterEach(() => vi.restoreAllMocks());

function mountPanel(content = '# Plan\n\nShip this carefully.') {
  return mount(PlanReviewPanel, {
    props: {
      panel: {
        kind: 'markdown' as const,
        purpose: 'plan' as const,
        title: 'Plan',
        content,
        state: 'idle' as const,
        error: null,
      },
    },
  });
}

describe('PlanReviewPanel', () => {
  it('renders the plan and emits confirm and cancel actions', async () => {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('Ship this carefully.');
    await nextTick();
    await wrapper.get('.markdown-panel button[aria-expanded]').trigger('click');
    expect(wrapper.get('[aria-label="Document outline"] button').text()).toBe('Plan');
    expect(wrapper.findAll('.plan-review-footer__button').map((button) => button.text())).toStrictEqual(['Cancel', 'Confirm']);

    await wrapper.findAll('.plan-review-footer__button')[0]?.trigger('click');
    await wrapper.findAll('.plan-review-footer__button')[1]?.trigger('click');

    expect(wrapper.emitted('confirmPlan')).toStrictEqual([[]]);
    expect(wrapper.emitted('cancelPlan')).toStrictEqual([[]]);
  });

  it('collects selected-text comments and emits them as one batch', async () => {
    const wrapper = mountPanel();
    mockPlanSelection(wrapper, 'Ship this carefully.');

    await wrapper.get('.markdown-panel').trigger('mouseup');
    await wrapper.get('.annotation-popup__input').setValue('Split this into smaller steps.');
    await wrapper.get('form.annotation-popup').trigger('submit');
    await wrapper.get('[aria-label="Send 1 comment"]').trigger('click');

    expect(wrapper.emitted('commentPlan')).toStrictEqual([[
      [
        {
          id: 'plan-comment-1',
          quote: 'Ship this carefully.',
          body: 'Split this into smaller steps.',
        },
      ],
    ]]);
    expect(wrapper.findAll('.plan-review-footer button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('clears submitted comments when a revised plan arrives', async () => {
    const wrapper = mountPanel();
    mockPlanSelection(wrapper, 'Ship this carefully.');
    await wrapper.get('.markdown-panel').trigger('mouseup');
    await wrapper.get('.annotation-popup__input').setValue('Make this safer.');
    await wrapper.get('form.annotation-popup').trigger('submit');
    await wrapper.get('[aria-label="Send 1 comment"]').trigger('click');

    await (wrapper as unknown as { setProps: (props: Record<string, unknown>) => Promise<void> }).setProps({
      panel: {
        kind: 'markdown',
        purpose: 'plan',
        title: 'Plan',
        content: '# Revised plan',
        state: 'idle',
        error: null,
      },
    });

    expect(wrapper.find('.plan-review-footer__comment').exists()).toBe(false);
    expect(wrapper.text()).toContain('Select text in the plan to add an inline comment.');
  });

  it('locks review controls while the plan is updating', async () => {
    const wrapper = mount(PlanReviewPanel, {
      props: {
        panel: {
          kind: 'markdown',
          purpose: 'plan',
          title: 'Plan',
          content: '# Plan',
          state: 'idle',
          error: null,
        },
        planUpdating: true,
      },
    });

    expect(wrapper.get('.plan-review-panel__overlay').text()).toBe('Updating plan...');
    expect(wrapper.findAll('.plan-review-footer button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);

    await (wrapper as unknown as { setProps: (props: Record<string, unknown>) => Promise<void> }).setProps({ planUpdating: false });
    expect(wrapper.find('.plan-review-panel__overlay').exists()).toBe(false);
  });

  it('dismisses an unfinished inline comment on outside click', async () => {
    const wrapper = mountPanel();
    mockPlanSelection(wrapper, 'Ship this carefully.');
    await wrapper.get('.markdown-panel').trigger('mouseup');

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();

    expect(wrapper.find('.annotation-popup').exists()).toBe(false);
  });

  it('edits, deletes, and clears saved comments', async () => {
    const wrapper = mountPanel();
    mockPlanSelection(wrapper, 'Ship this carefully.');
    await wrapper.get('.markdown-panel').trigger('mouseup');
    await wrapper.get('.annotation-popup__input').setValue('First comment');
    await wrapper.get('form.annotation-popup').trigger('submit');

    await wrapper.get('[aria-label="Edit comment"]').trigger('click');
    expect((wrapper.get('.annotation-popup__input').element as HTMLInputElement).value).toBe('First comment');
    await wrapper.get('.annotation-popup__input').setValue('Revised comment');
    await wrapper.get('form.annotation-popup').trigger('submit');
    expect(wrapper.get('.plan-review-footer__comment').attributes('title')).toContain('Revised comment');

    await wrapper.get('[aria-label="Delete comment"]').trigger('click');
    expect(wrapper.find('.plan-review-footer__comment').exists()).toBe(false);

    mockPlanSelection(wrapper, 'Ship this carefully.');
    await wrapper.get('.markdown-panel').trigger('mouseup');
    await wrapper.get('.annotation-popup__input').setValue('Clear me');
    await wrapper.get('form.annotation-popup').trigger('submit');
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    await wrapper.findAll('.plan-review-footer__button').find((button) => button.text() === 'Clear')!.trigger('click');
    await nextTick();
    expect(wrapper.find('.plan-review-footer__comment').exists()).toBe(false);
  });

  it('keeps comments when clear is canceled and truncates long selections', async () => {
    const wrapper = mountPanel();
    mockPlanSelection(wrapper, 'x'.repeat(220));
    await wrapper.get('.markdown-panel').trigger('mouseup');
    expect(wrapper.get('form.annotation-popup').attributes('aria-description')).toBe(`${'x'.repeat(177)}...`);
    await wrapper.get('.annotation-popup__input').setValue('Keep me');
    await wrapper.get('form.annotation-popup').trigger('submit');
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'));
    await wrapper.findAll('.plan-review-footer__button').find((button) => button.text() === 'Clear')!.trigger('click');
    await nextTick();
    expect(wrapper.find('.plan-review-footer__comment').exists()).toBe(true);
  });
});

function mockPlanSelection(wrapper: ReturnType<typeof mount>, text: string): void {
  const markdownElement = wrapper.get('.markdown-panel').element;
  vi.spyOn(window, 'getSelection').mockReturnValue({
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      commonAncestorContainer: markdownElement,
      getBoundingClientRect: () => ({
        bottom: 80,
        left: 20,
        top: 60,
        right: 220,
        width: 200,
        height: 20,
        x: 20,
        y: 60,
        toJSON: () => undefined,
      } as DOMRect),
    } as unknown as Range),
    removeAllRanges: vi.fn(),
  } as unknown as Selection);
}
