import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import TeamDialog from '../TeamDialog.vue';
import { teamColors } from '@workspace/core/team-colors';
import type { CreateTeamInput, Team, UpdateTeamInput } from '@workspace/core/contracts';

describe('TeamDialog', () => {
  it('renders the Skwad-style create team layout and disables save until named', () => {
    const wrapper = mountDialog();

    expect(wrapper.get('.app-dialog__title').text()).toBe('Create Team');
    expect(wrapper.find('.app-dialog__subtitle').exists()).toBe(false);
    expect(wrapper.findAll('.app-form-dialog__field')).toHaveLength(2);
    expect(wrapper.text()).toContain('Name');
    expect(wrapper.text()).not.toContain('Connection');
    expect(wrapper.text()).toContain('Color');
    expect(wrapper.text()).not.toContain("Choose where this team's agents run.");
    expect(wrapper.text()).not.toContain('Give this team a name for the sidebar.');
    expect(wrapper.findAll('.app-form-dialog__label').map((label) => label.text())).toStrictEqual([
      'Name',
      'Color',
    ]);
    expect(wrapper.get('#team-dialog-name').attributes('placeholder')).toBe('Enter team name');
    expect(wrapper.findAll('.team-dialog__color')).toHaveLength(teamColors.length);
    expect(wrapper.find('.team-dialog__preview').exists()).toBe(false);
    expect(wrapper.findAll('.app-dialog__footer .app-button').map((button) => button.classes())).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);
    expect(saveButton(wrapper).attributes()).toHaveProperty('disabled');
  });

  it('creates a team with the selected Skwad color', async () => {
    const createTeam = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({ createTeam });

    await wrapper.get('#team-dialog-name').setValue('Skwad Core');
    await wrapper.findAll('.team-dialog__color')[10]?.trigger('click');
    await saveButton(wrapper).trigger('click');

    expect(createTeam).toHaveBeenCalledWith({
      name: 'Skwad Core',
      color: '#46A857',
    });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('edits an existing team with prefilled values', async () => {
    const updateTeam = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountDialog({
      mode: 'edit',
      team: {
        id: 'team-app',
        name: `${product.name}`,
        avatar: 'CC',
        color: '#1B4FB2',
        agentIds: ['agent-dina'],
      },
      updateTeam,
    });

    expect(wrapper.get('.app-dialog__title').text()).toBe('Edit Team');
    expect((wrapper.get('#team-dialog-name').element as HTMLInputElement).value).toBe(`${product.name}`);

    await wrapper.get('#team-dialog-name').setValue('Skwad Core');
    await wrapper.findAll('.team-dialog__color')[10]?.trigger('click');
    await saveButton(wrapper, 'Save').trigger('click');

    expect(updateTeam).toHaveBeenCalledWith({
      id: 'team-app',
      name: 'Skwad Core',
      color: '#46A857',
    });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });

  it('keeps the dialog open and shows create errors', async () => {
    const createTeam = vi.fn().mockRejectedValue(new Error('Team color is invalid.'));
    const wrapper = mountDialog({ createTeam });

    await wrapper.get('#team-dialog-name').setValue('Broken Team');
    await saveButton(wrapper).trigger('click');

    expect(wrapper.text()).toContain('Team color is invalid.');
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});

function mountDialog(overrides: Partial<{
  createTeam: (input: CreateTeamInput) => Promise<Team | null | void>;
  mode: 'create' | 'edit';
  team: Team | null;
  updateTeam: (input: UpdateTeamInput) => Promise<void>;
}> = {}) {
  return mount(TeamDialog, {
    props: {
      createTeam: vi.fn().mockResolvedValue(undefined),
      visible: true,
      ...overrides,
    },
    global: {
      stubs: {
        ElDialog: {
          props: ['modelValue'],
          template: `
            <section v-if="modelValue" class="team-dialog-test-shell">
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

function saveButton(wrapper: ReturnType<typeof mountDialog>, label = 'Create Team') {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!button) {
    throw new Error(`${label} button not found`);
  }

  return button;
}
