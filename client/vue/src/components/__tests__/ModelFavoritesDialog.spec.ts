import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BackendModelOption, ModelFavorite } from '@workspace/core/contracts';
import ModelFavoritesDialog from '../ModelFavoritesDialog.vue';

const favorites: ModelFavorite[] = [{
  backend: 'codex',
  modelId: 'terra',
  reasoningEffort: 'medium',
  serviceTier: 'priority',
}, {
  backend: 'codex',
  modelId: 'sol',
  reasoningEffort: 'high',
  serviceTier: null,
}];

const models: BackendModelOption[] = [{
  id: 'terra',
  model: 'gpt-5.6-terra',
  displayName: 'GPT-5.6 Terra',
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Fast responses' }],
  defaultServiceTier: null,
  isDefault: true,
}, {
  id: 'sol',
  model: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: 'high',
  defaultServiceTier: null,
  isDefault: false,
}];

describe('ModelFavoritesDialog', () => {
  it('shows only reorder and delete controls and emits deletion immediately', async () => {
    const wrapper = mountDialog();

    expect(wrapper.get('.app-dialog__title').text()).toBe('Model favorites');
    expect(wrapper.text()).toContain('Drag favorites to reorder.');
    expect(wrapper.text()).toContain('GPT-5.6 Terra');
    expect(wrapper.text()).toContain('Medium · Fast');
    expect(wrapper.text()).toContain('GPT-5.6 Sol');
    expect(wrapper.text()).not.toContain('Add current');

    await wrapper.get('button[aria-label="Remove GPT-5.6 Terra"]').trigger('click');

    expect(wrapper.emitted('change')).toStrictEqual([[favorites.slice(1)]]);
    expect(wrapper.text()).not.toContain('GPT-5.6 Terra');
  });

  it('reorders by keyboard and drag', async () => {
    const wrapper = mountDialog();
    const reorderButtons = wrapper.findAll('.model-favorites-dialog__reorder');

    await reorderButtons[1]!.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.emitted('change')?.[0]).toStrictEqual([[favorites[1], favorites[0]]]);

    const rows = wrapper.findAll('.model-favorites-dialog__row');
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => undefined };
    await rows[0]!.trigger('dragstart', { dataTransfer });
    await rows[1]!.trigger('dragover', { clientY: 1, dataTransfer });
    await rows[1]!.trigger('drop', { clientY: 1, dataTransfer });

    expect(wrapper.emitted('change')?.[1]).toStrictEqual([[favorites[0], favorites[1]]]);
  });

  it('closes without adding another action to the dialog', async () => {
    const wrapper = mountDialog();

    await wrapper.get('.app-dialog__footer .app-button').trigger('click');

    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });
});

function mountDialog() {
  return mount(ModelFavoritesDialog, {
    props: { favorites, models, visible: true },
    global: {
      stubs: {
        ElDialog: {
          props: ['modelValue'],
          template: `
            <section v-if="modelValue">
              <slot name="header" />
              <slot />
              <slot name="footer" />
            </section>
          `,
        },
      },
    },
  });
}
