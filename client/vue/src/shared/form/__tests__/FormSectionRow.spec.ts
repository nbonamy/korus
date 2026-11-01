import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FormRow from '../FormRow.vue';
import FormSection from '../FormSection.vue';

describe('FormSection and FormRow', () => {
  it('opts into tighter row spacing without changing default sections or typography', () => {
    const wrapper = mount({
      components: { FormRow, FormSection },
      template: `<div>
        <FormSection><FormRow title="Default settings" /></FormSection>
        <FormSection density="compact"><FormRow title="Compact form" /></FormSection>
      </div>`,
    }, { attachTo: document.body });
    const rows = wrapper.findAll('.form-row');
    const normal = getComputedStyle(rows[0]!.element);
    const compact = getComputedStyle(rows[1]!.element);
    expect(normal.padding).not.toBe('');
    expect(compact.padding).not.toBe('');
    expect(compact.padding).not.toBe(normal.padding);
    expect(compact.gap).not.toBe(normal.gap);
    expect(getComputedStyle(rows[1]!.get('strong').element).fontSize)
      .toBe(getComputedStyle(rows[0]!.get('strong').element).fontSize);
    wrapper.unmount();
  });

  it('renders a labelled settings section with grouped rows', () => {
    const wrapper = mount({
      components: { FormRow, FormSection },
      template: `
        <FormSection title="Behavior" title-id="settings-behavior-title">
          <FormRow title="Prevent sleep" description="Keep this computer awake" />
          <FormRow title="Another option" error="Needs attention" />
        </FormSection>
      `,
    });

    expect(wrapper.attributes('aria-labelledby')).toBe('settings-behavior-title');
    expect(wrapper.get('#settings-behavior-title').text()).toBe('Behavior');
    expect(wrapper.text()).toContain('Prevent sleep');
    expect(wrapper.text()).toContain('Keep this computer awake');
    expect(wrapper.text()).toContain('Needs attention');
    expect(wrapper.findAll('.form-row')).toHaveLength(2);
  });

  it('uses article rows by default and supports label rows with controls', () => {
    const wrapper = mount({
      components: { FormRow },
      template: `
        <div>
          <FormRow title="Plain row" />
          <FormRow as="label" title="Switch row">
            <template #control>
              <input type="checkbox" aria-label="Switch row" />
            </template>
          </FormRow>
        </div>
      `,
    });

    const rows = wrapper.findAll('.form-row');

    expect(rows[0].element.tagName).toBe('ARTICLE');
    expect(rows[1].element.tagName).toBe('LABEL');
    expect(rows[1].get('input').attributes('aria-label')).toBe('Switch row');
  });
});
