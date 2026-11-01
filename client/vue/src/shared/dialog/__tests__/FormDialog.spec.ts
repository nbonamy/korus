import { flushPromises, mount } from '@vue/test-utils';
import { ElDialog } from 'element-plus';
import { describe, expect, it } from 'vitest';
import FormDialog from '../FormDialog.vue';
import FormField from '../../form/FormField.vue';
import '../../../styles/base.css';

describe('FormDialog', () => {
  it('isolates dialog content from right-aligned parents while keeping footer actions right-aligned', async () => {
    const shell = document.createElement('div');
    shell.style.textAlign = 'right';
    document.body.append(shell);
    const wrapper = mount(FormDialog, {
      attachTo: shell,
      props: { modelValue: true, title: 'Prune repository', subtitle: 'korus' },
      slots: { default: '<p>Choose branches</p>', footer: '<button>Cancel</button><button>Prune</button>' },
      global: { components: { ElDialog }, stubs: { ElDialog: false, teleport: false } },
    });
    try {
      await flushPromises();
      expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Prune repository');
      expect(getComputedStyle(wrapper.get('.el-dialog').element).textAlign).toBe('left');
      expect(getComputedStyle(wrapper.get('.el-dialog__footer').element).textAlign).toBe('right');
      expect(getComputedStyle(wrapper.get('.app-form-dialog__footer-actions').element).marginLeft).toBe('auto');
    } finally { wrapper.unmount(); shell.remove(); }
  });

  it('teleports outside a hidden shell when requested', async () => {
    const shell = document.createElement('main');
    shell.style.visibility = 'hidden';
    document.body.append(shell);
    const wrapper = mount(FormDialog, {
      attachTo: shell,
      props: { modelValue: true, title: 'Provider setup', teleported: true },
      slots: { default: '<input aria-label="Setup" />' },
      global: { components: { ElDialog }, stubs: { ElDialog: false, teleport: false } },
    });
    try {
      await flushPromises();
      expect(shell.querySelector('[role="dialog"]')).toBeNull();
      const dialog = document.body.querySelector('[role="dialog"]');
      expect(dialog?.querySelector('input')?.getAttribute('aria-label')).toBe('Setup');
      expect(getComputedStyle(dialog!).visibility).toBe('visible');
    } finally { wrapper.unmount(); shell.remove(); }
  });
  it('renders canonical header, body, and split footer regions', () => {
    const wrapper = mount(FormDialog, {
      props: {
        modelValue: true,
        title: 'Create team',
        subtitle: 'Choose how this team should work.',
      },
      slots: {
        default: '<form><input aria-label="Name" /></form>',
        'footer-left': '<span>Advanced</span>',
        footer: '<button>Cancel</button><button>Create</button>',
      },
      global: {
        stubs: { ElDialog: dialogStub() },
      },
    });

    expect(wrapper.get('.app-dialog__title').text()).toBe('Create team');
    expect(wrapper.get('.app-dialog__subtitle').text()).toBe('Choose how this team should work.');
    expect(wrapper.get('input').attributes('aria-label')).toBe('Name');
    expect(wrapper.get('.app-form-dialog__footer-left').text()).toBe('Advanced');
    expect(wrapper.findAll('.app-form-dialog__footer-actions button').map((button) => button.text())).toStrictEqual([
      'Cancel',
      'Create',
    ]);
  });

  it('relays visibility changes', async () => {
    const wrapper = mount(FormDialog, {
      props: {
        modelValue: true,
        title: 'Edit agent',
      },
      global: {
        stubs: { ElDialog: dialogStub() },
      },
    });

    wrapper.getComponent({ name: 'ElDialog' }).vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[false]]);
  });
});

function dialogStub() {
  return {
    name: 'ElDialog',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `
      <section v-if="modelValue">
        <slot name="header" />
        <slot />
        <slot name="footer" />
      </section>
    `,
  };
}

describe('FormField', () => {
  it('renders a label and help above its control', () => {
    const wrapper = mount(FormField, {
      props: {
        label: 'Repository',
        labelFor: 'repository',
        help: 'Choose where this session should work.',
      },
      slots: {
        default: '<input id="repository" />',
      },
    });

    expect(wrapper.get('label').attributes('for')).toBe('repository');
    expect(wrapper.get('label').text()).toBe('Repository');
    expect(wrapper.get('.app-form-dialog__help').text()).toBe('Choose where this session should work.');
    expect(wrapper.findAll('.app-form-dialog__field > *').map((node) => node.element.tagName)).toStrictEqual([
      'DIV',
      'INPUT',
    ]);
  });
});
