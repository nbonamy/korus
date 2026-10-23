import { computed, defineComponent, Fragment, h, inject, provide, ref, type InjectionKey, type VNode } from 'vue';

const dropdownCommandKey: InjectionKey<(command: unknown) => void> = Symbol('dropdown-command');
const menuSelectKey: InjectionKey<(index: string) => void> = Symbol('menu-select');
const radioGroupKey: InjectionKey<{
  disabled: () => boolean;
  modelValue: () => unknown;
  select: (value: unknown) => void;
}> = Symbol('radio-group');

const flattenNodes = (nodes: VNode[]): VNode[] => nodes.flatMap((node) => {
  return node.type === Fragment && Array.isArray(node.children)
    ? flattenNodes(node.children as VNode[])
    : [node];
});

const buttonProps = {
  circle: Boolean,
  disabled: Boolean,
  link: Boolean,
  loading: Boolean,
  nativeType: String,
  plain: Boolean,
  size: String,
  text: Boolean,
  type: String,
};
const inputProps = ['autosize', 'disabled', 'maxlength', 'modelValue', 'placeholder', 'rows', 'showWordLimit', 'size', 'type'];

export const ElAlertStub = defineComponent({
  name: 'ElAlert',
  props: ['closable', 'description', 'showIcon', 'title', 'type'],
  template: '<div class="el-alert" role="alert" v-bind="$attrs"><slot name="title">{{ title }}</slot><slot /></div>',
});

export const ElButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  props: buttonProps,
  emits: ['click'],
  template: '<button class="el-button" v-bind="$attrs" :disabled="disabled || loading" :type="nativeType || \'button\'" @click="$emit(\'click\', $event)"><slot /></button>',
});

export const ElCheckboxStub = defineComponent({
  name: 'ElCheckbox',
  inheritAttrs: false,
  props: ['disabled', 'label', 'modelValue'],
  emits: ['change', 'update:modelValue'],
  template: `<label class="el-checkbox" v-bind="$attrs"><input type="checkbox" :checked="Boolean(modelValue)" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked); $emit('change', $event.target.checked)"><slot />{{ label }}</label>`,
});

export const ElDialogStub = defineComponent({
  name: 'ElDialog',
  inheritAttrs: false,
  props: {
    alignCenter: Boolean,
    appendToBody: Boolean,
    beforeClose: Function,
    closeOnClickModal: Boolean,
    closeOnPressEscape: Boolean,
    destroyOnClose: Boolean,
    fullscreen: Boolean,
    modelValue: Boolean,
    showClose: Boolean,
    teleported: Boolean,
    title: String,
    top: String,
    width: [String, Number],
  },
  emits: ['close', 'closed', 'open', 'opened', 'update:modelValue'],
  template: `<Teleport to="body" :disabled="!(teleported || appendToBody)"><section v-if="modelValue" class="el-dialog" v-bind="$attrs" role="dialog" aria-labelledby="el-dialog-title"><header id="el-dialog-title" class="el-dialog__header"><slot name="header">{{ title }}</slot></header><div class="el-dialog__body"><slot /></div><footer class="el-dialog__footer"><slot name="footer" /></footer></section></Teleport>`,
});

export const ElDropdownStub = defineComponent({
  name: 'ElDropdown',
  props: ['disabled', 'hideOnClick', 'placement', 'teleported', 'trigger'],
  emits: ['command', 'visibleChange'],
  setup(_, { emit }) {
    const open = ref(false);
    const setOpen = (value: boolean) => {
      open.value = value;
      emit('visibleChange', value);
    };
    provide(dropdownCommandKey, (command) => {
      emit('command', command);
      setOpen(false);
    });
    return { open, setOpen };
  },
  template: '<div class="el-dropdown" @click="setOpen(true)"><slot /><template v-if="open"><slot name="dropdown" /></template></div>',
});

export const ElDropdownMenuStub = defineComponent({
  name: 'ElDropdownMenu',
  template: '<div role="menu"><slot /></div>',
});

export const ElDropdownItemStub = defineComponent({
  name: 'ElDropdownItem',
  inheritAttrs: false,
  props: ['command', 'disabled', 'divided', 'icon'],
  setup(props) {
    const command = inject(dropdownCommandKey, () => undefined);
    return { select: () => command(props.command) };
  },
  template: '<button class="el-dropdown-menu__item" v-bind="$attrs" role="menuitem" :disabled="disabled" @click.stop="select"><slot /></button>',
});

export const ElInputStub = defineComponent({
  name: 'ElInput',
  inheritAttrs: false,
  props: inputProps,
  emits: ['blur', 'change', 'focus', 'input', 'keydown', 'update:modelValue'],
  setup(_, { expose }) {
    const input = ref<HTMLInputElement | HTMLTextAreaElement>();
    expose({ focus: () => input.value?.focus() });
    return { input };
  },
  template: `<textarea v-if="type === 'textarea'" ref="input" v-bind="$attrs" :disabled="disabled" :maxlength="maxlength" :placeholder="placeholder" :rows="rows" :value="modelValue" @blur="$emit('blur', $event)" @change="$emit('change', $event.target.value)" @focus="$emit('focus', $event)" @input="$emit('update:modelValue', $event.target.value); $emit('input', $event.target.value)" @keydown="$emit('keydown', $event)" /><input v-else ref="input" v-bind="$attrs" :disabled="disabled" :maxlength="maxlength" :placeholder="placeholder" :type="type || 'text'" :value="modelValue" @blur="$emit('blur', $event)" @change="$emit('change', $event.target.value)" @focus="$emit('focus', $event)" @input="$emit('update:modelValue', $event.target.value); $emit('input', $event.target.value)" @keydown="$emit('keydown', $event)">`,
});

export const ElInputNumberStub = defineComponent({
  name: 'ElInputNumber',
  inheritAttrs: false,
  props: ['controls', 'disabled', 'max', 'min', 'modelValue', 'precision', 'step'],
  emits: ['change', 'update:modelValue'],
  template: `<input v-bind="$attrs" type="number" :disabled="disabled" :max="max" :min="min" :step="step" :value="modelValue" @change="$emit('change', Number($event.target.value))" @input="$emit('update:modelValue', Number($event.target.value))">`,
});

export const ElLinkStub = defineComponent({
  name: 'ElLink',
  inheritAttrs: false,
  props: ['disabled', 'href', 'icon', 'target', 'type', 'underline'],
  template: '<a v-bind="$attrs" :href="href" :target="target"><slot /></a>',
});

export const ElMenuStub = defineComponent({
  name: 'ElMenu',
  props: ['collapse', 'defaultActive', 'ellipsis', 'mode'],
  emits: ['select'],
  setup(_, { emit }) {
    provide(menuSelectKey, (index) => emit('select', index));
  },
  template: '<nav class="el-menu"><slot /></nav>',
});

export const ElMenuItemStub = defineComponent({
  name: 'ElMenuItem',
  inheritAttrs: false,
  props: ['disabled', 'index'],
  setup(props) {
    const select = inject(menuSelectKey, () => undefined);
    return { activate: () => select(String(props.index)) };
  },
  template: '<button class="el-menu-item" v-bind="$attrs" :disabled="disabled" @click="activate"><slot /></button>',
});

export const ElMenuItemGroupStub = defineComponent({
  name: 'ElMenuItemGroup',
  props: ['title'],
  template: '<li class="el-menu-item-group"><div class="el-menu-item-group__title">{{ title }}</div><ul><slot /></ul></li>',
});

export const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: ['disabled', 'label', 'value'],
  template: '<option :disabled="disabled" :value="value"><slot>{{ label }}</slot></option>',
});

export const ElPopoverStub = defineComponent({
  name: 'ElPopover',
  props: {
    disabled: Boolean,
    hideAfter: Number,
    offset: Number,
    placement: String,
    popperClass: String,
    teleported: Boolean,
    trigger: String,
    visible: { type: Boolean, default: undefined },
    width: [String, Number],
  },
  emits: ['beforeEnter', 'beforeLeave', 'hide', 'show', 'update:visible'],
  setup(props, { emit }) {
    const internalVisible = ref(false);
    const shown = computed(() => props.visible ?? internalVisible.value);
    const toggle = () => {
      if (props.disabled || props.trigger === 'manual') return;
      // Toggle what is actually shown, so a controlled `visible` that was closed from outside reopens.
      internalVisible.value = !shown.value;
      emit('update:visible', internalVisible.value);
    };
    return { shown, toggle };
  },
  template: '<span class="el-popover"><span @click="toggle"><slot name="reference" /></span><Teleport to="body" :disabled="!teleported"><span v-if="shown" :class="popperClass"><slot /></span></Teleport></span>',
});

export const ElRadioGroupStub = defineComponent({
  name: 'ElRadioGroup',
  inheritAttrs: false,
  props: ['disabled', 'modelValue'],
  emits: ['change', 'update:modelValue'],
  setup(props, { emit }) {
    provide(radioGroupKey, {
      disabled: () => Boolean(props.disabled),
      modelValue: () => props.modelValue,
      select: (value) => {
        emit('update:modelValue', value);
        emit('change', value);
      },
    });
  },
  template: '<div class="el-radio-group" role="radiogroup" v-bind="$attrs"><slot /></div>',
});

export const ElRadioStub = defineComponent({
  name: 'ElRadio',
  inheritAttrs: false,
  props: ['disabled', 'label', 'value'],
  setup(props) {
    const group = inject(radioGroupKey, null);
    return {
      checked: computed(() => group?.modelValue() === (props.value ?? props.label)),
      isDisabled: computed(() => Boolean(props.disabled || group?.disabled())),
      select: () => group?.select(props.value ?? props.label),
    };
  },
  template: '<label class="el-radio" v-bind="$attrs"><input type="radio" :checked="checked" :disabled="isDisabled" @change="select"><slot /></label>',
});

export const ElSegmentedStub = defineComponent({
  name: 'ElSegmented',
  props: ['disabled', 'modelValue', 'options', 'size'],
  emits: ['change', 'update:modelValue'],
  template: '<div role="radiogroup"><button v-for="option in options" :key="String(option.value ?? option)" type="button" @click="$emit(\'update:modelValue\', option.value ?? option); $emit(\'change\', option.value ?? option)">{{ option.label ?? option }}</button></div>',
});

export const ElSelectStub = defineComponent({
  name: 'ElSelect',
  inheritAttrs: false,
  props: ['clearable', 'collapseTags', 'disabled', 'filterable', 'modelValue', 'multiple', 'placeholder', 'teleported'],
  emits: ['change', 'clear', 'removeTag', 'update:modelValue', 'visibleChange'],
  setup(props, { slots }) {
    const selectedLabel = computed(() => {
      const options = flattenNodes(slots.default?.() ?? []);
      const selected = options.find((option) => option.props?.value === props.modelValue);
      return selected?.props?.label ?? props.placeholder ?? '';
    });
    return { selectedLabel };
  },
  template: '<div class="el-select" v-bind="$attrs"><select :disabled="disabled" :multiple="multiple" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select><span v-if="selectedLabel" class="el-select__placeholder">{{ selectedLabel }}</span></div>',
});

export const ElSwitchStub = defineComponent({
  name: 'ElSwitch',
  inheritAttrs: false,
  props: ['activeText', 'activeValue', 'disabled', 'inactiveText', 'inactiveValue', 'modelValue', 'size'],
  emits: ['change', 'update:modelValue'],
  setup(props, { emit }) {
    return {
      toggle: () => {
        if (props.disabled) return;
        emit('update:modelValue', !props.modelValue);
        emit('change', !props.modelValue);
      },
    };
  },
  template: '<label class="el-switch" v-bind="$attrs" @click.prevent="toggle"><input type="checkbox" role="switch" :aria-label="$attrs[\'aria-label\']" :aria-checked="Boolean(modelValue)" :checked="Boolean(modelValue)" :disabled="disabled" @click.stop @change.stop="$emit(\'update:modelValue\', $event.target.checked); $emit(\'change\', $event.target.checked)"><span>{{ modelValue ? activeText : inactiveText }}</span></label>',
});

export const ElTabPaneStub = defineComponent({
  name: 'ElTabPane',
  props: ['disabled', 'label', 'lazy', 'name'],
  template: '<section role="tabpanel"><slot /></section>',
});

export const ElTabsStub = defineComponent({
  name: 'ElTabs',
  props: ['modelValue', 'stretch', 'tabPosition', 'type'],
  emits: ['tabChange', 'tabClick', 'update:modelValue'],
  setup(props, { emit, slots }) {
    return () => {
      const panes = flattenNodes(slots.default?.() ?? []).filter((pane) => pane.props?.name !== undefined);
      const tabs = panes.map((pane) => {
        const name = String(pane.props?.name ?? '');
        return h('button', {
          class: ['el-tabs__item', { 'is-active': props.modelValue === name }],
          disabled: Boolean(pane.props?.disabled),
          role: 'tab',
          type: 'button',
          onClick: () => {
            emit('update:modelValue', name);
            emit('tabChange', name);
            emit('tabClick', { paneName: name });
          },
        }, String(pane.props?.label ?? ''));
      });
      return h('div', { class: 'el-tabs' }, [h('div', { class: 'el-tabs__nav', role: 'tablist' }, tabs), ...panes]);
    };
  },
});

export const ElTooltipStub = defineComponent({
  name: 'ElTooltip',
  props: ['content', 'disabled', 'effect', 'hideAfter', 'placement', 'showAfter'],
  template: '<span><slot /></span>',
});

export const elementPlusStubs = {
  ElAlert: ElAlertStub,
  ElButton: ElButtonStub,
  ElCheckbox: ElCheckboxStub,
  ElDialog: ElDialogStub,
  ElDropdown: ElDropdownStub,
  ElDropdownItem: ElDropdownItemStub,
  ElDropdownMenu: ElDropdownMenuStub,
  ElInput: ElInputStub,
  ElInputNumber: ElInputNumberStub,
  ElLink: ElLinkStub,
  ElMenu: ElMenuStub,
  ElMenuItem: ElMenuItemStub,
  ElMenuItemGroup: ElMenuItemGroupStub,
  ElOption: ElOptionStub,
  ElPopover: ElPopoverStub,
  ElRadio: ElRadioStub,
  ElRadioGroup: ElRadioGroupStub,
  ElSegmented: ElSegmentedStub,
  ElSelect: ElSelectStub,
  ElSwitch: ElSwitchStub,
  ElTabPane: ElTabPaneStub,
  ElTabs: ElTabsStub,
  ElTooltip: ElTooltipStub,
};
