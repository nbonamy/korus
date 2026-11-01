import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { backendChoicesKey } from '../backend-selection';
import { describe, expect, it } from 'vitest';
import type { WorkSource } from '@workspace/core/contracts';
import RepositoryAcquireDialog from '../RepositoryAcquireDialog.vue';

const repositories: WorkSource[] = [
  {
    provider: 'github',
    id: 'nbonamy/agent-workspace',
    owner: 'nbonamy',
    name: 'agent-workspace',
    fullName: 'nbonamy/agent-workspace',
    url: 'https://github.com/nbonamy/agent-workspace',
    isPrivate: true,
  },
  {
    provider: 'github',
    id: 'nbonamy/multi-llm-ts',
    owner: 'nbonamy',
    name: 'multi-llm-ts',
    fullName: 'nbonamy/multi-llm-ts',
    url: 'https://github.com/nbonamy/multi-llm-ts',
    isPrivate: false,
  },
];

describe('RepositoryAcquireDialog', () => {
  it('connects only GitLab and filters out foreign provider catalogs and authorization', async () => {
    const wrapper = mount(RepositoryAcquireDialog, { props: { visible: true, mode: 'gitlab', connection: { provider: 'github', status: 'connected' }, authorization: { provider: 'github', verificationUri: 'https://github.com/login/device', userCode: 'FOREIGN', expiresAt: '2099-01-01T00:00:00.000Z' } } });
    expect(wrapper.text()).toContain('Connect GitLab');
    expect(wrapper.text()).not.toContain('FOREIGN');
    await wrapper.get('.repository-acquire-dialog__connect button').trigger('click');
    expect(wrapper.emitted('connect')).toStrictEqual([[]]);
    await wrapper.setProps({ connection: { provider: 'gitlab', status: 'connected' }, repositories: [...repositories, { ...repositories[0]!, provider: 'gitlab', id: '42', fullName: 'group/subgroup/agent-workspace', url: 'https://gitlab.com/group/subgroup/agent-workspace' }], localRepositoryIdentities: ['github.com/group/subgroup/agent-workspace'] });
    expect(wrapper.findAll('.repository-acquire-dialog__row')).toHaveLength(1);
    expect(wrapper.get('input').attributes('placeholder')).toContain('GitLab');
    expect(wrapper.findComponent({ name: 'GitLabIcon' }).exists()).toBe(true);
    expect(wrapper.get('.repository-acquire-dialog__row em').text()).toBe('Clone');
  });

  it('filters GitHub repositories and distinguishes local projects from clone targets', async () => {
    const wrapper = mount(RepositoryAcquireDialog, {
      props: {
        visible: true,
        mode: 'github',
        connection: { provider: 'github', status: 'connected', accountLabel: 'nbonamy' },
        repositories,
        localRepositoryIdentities: ['github.com/nbonamy/agent-workspace'],
      },
    });
    await flushPromises();

    expect(wrapper.get('.el-dialog').classes()).toContain('app-dialog--compact');
    const resultsRegion = wrapper.get('.repository-acquire-dialog__body');
    expect(resultsRegion.classes()).toContain('repository-acquire-dialog__scroll-region');
    expect(wrapper.text()).toContain('Already cloned');
    expect(wrapper.text()).toContain('Open');
    expect(wrapper.text()).toContain('Clone');
    expect(wrapper.findComponent({ name: 'GitHubIcon' }).exists()).toBe(true);
    expect(wrapper.get('.repository-acquire-dialog__name').element.tagName).toBe('SPAN');
    expect(wrapper.get('.repository-acquire-dialog__name').text()).toBe('nbonamy/agent-workspace');

    await wrapper.get('input').setValue('multi');
    expect(wrapper.findAll('.repository-acquire-dialog__row')).toHaveLength(1);

    await wrapper.get('.repository-acquire-dialog__row').trigger('click');
    expect(wrapper.emitted('select-repository')).toStrictEqual([[repositories[1]]]);

    await wrapper.get('input').setValue('missing');
    expect(wrapper.text()).toContain('No matching repositories.');
    expect(wrapper.find('.repository-acquire-dialog__body--state').exists()).toBe(true);
    expect(wrapper.get('.repository-acquire-dialog__body').element).toBe(resultsRegion.element);
    expect(wrapper.get('.repository-acquire-dialog__body').classes()).toContain('repository-acquire-dialog__scroll-region');
    expect(wrapper.find('.repository-acquire-dialog__body h3').exists()).toBe(false);

    await wrapper.setProps({ loading: true });
    expect(wrapper.text()).toContain('Loading repositories…');
    expect(wrapper.get('.repository-acquire-dialog__body').element).toBe(resultsRegion.element);
    expect(wrapper.get('.repository-acquire-dialog__body').classes()).toContain('repository-acquire-dialog__scroll-region');
  });

  it('does not treat a same-named repository from another owner as local', async () => {
    const wrapper = mount(RepositoryAcquireDialog, {
      props: {
        visible: true,
        mode: 'github',
        connection: { provider: 'github', status: 'connected', accountLabel: 'nbonamy' },
        repositories: [{ ...repositories[0]!, id: 'openai/agent-workspace', owner: 'openai', fullName: 'openai/agent-workspace', url: 'https://github.com/openai/agent-workspace' }],
        localRepositoryIdentities: ['github.com/nbonamy/agent-workspace'],
      },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain('Already cloned');
    expect(wrapper.text()).toContain('Clone');
  });

  it('moves from GitHub connection onboarding to authorization and repository selection in one dialog', async () => {
    const wrapper = mount(RepositoryAcquireDialog, {
      props: {
        visible: true,
        mode: 'github',
        connection: { provider: 'github', status: 'disconnected' },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Connect GitHub');
    expect(wrapper.text()).toContain('Connect securely with your GitHub credentials.');
    expect(wrapper.find('.repository-acquire-dialog__search').exists()).toBe(false);
    expect(wrapper.find('.app-dialog__title').exists()).toBe(false);
    expect(wrapper.find('.repository-acquire-dialog__scroll-region').exists()).toBe(false);
    await wrapper.findAll('button').find((button) => button.text() === 'Connect GitHub')?.trigger('click');
    expect(wrapper.emitted('connect')).toStrictEqual([[]]);

    await wrapper.setProps({
      connection: { provider: 'github', status: 'connecting' },
      authorization: {
        provider: 'github',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresAt: '2026-06-09T12:05:00.000Z',
      },
    });
    expect(wrapper.text()).toContain(`Authorize ${product.name}`);
    expect(wrapper.text()).toContain('ABCD-1234');
    wrapper.getComponent({ name: 'WorkAuthorizationSteps' }).vm.$emit('open');
    expect(wrapper.emitted('open-authorization')).toStrictEqual([[]]);

    await wrapper.setProps({
      connection: { provider: 'github', status: 'connected', accountLabel: 'nbonamy' },
      authorization: null,
      repositories,
    });
    expect(wrapper.find('.repository-acquire-dialog__search').exists()).toBe(true);
    expect(wrapper.findAll('.repository-acquire-dialog__row')).toHaveLength(2);
  });

  it('validates and submits an explicit repository URL', async () => {
    const choices = ref<('codex' | 'claude')[]>(['codex']);
    const wrapper = mount(RepositoryAcquireDialog, {
      props: { visible: true, mode: 'url', connection: { provider: 'github', status: 'connected' } },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => choices.value) } },
    });
    await flushPromises();

    expect(wrapper.find('.app-form-dialog__footer-left').exists()).toBe(false);
    choices.value = ['codex', 'claude'];
    await flushPromises();

    expect(wrapper.find('.repository-acquire-dialog__search').exists()).toBe(false);
    expect(wrapper.find('.repository-acquire-dialog__body--state').exists()).toBe(false);
    expect(wrapper.find('.app-form-dialog__field [aria-label="Repository URL"]').exists()).toBe(true);
    expect(wrapper.find('.app-form-dialog__footer-left .backend-selector').exists()).toBe(true);
    expect(wrapper.get('.app-dialog__title').text()).toBe('Clone repository');
    expect(wrapper.get('.el-dialog').classes()).not.toContain('app-dialog--compact');
    expect(wrapper.get('[aria-label="Repository URL"]').attributes('placeholder')).toBe('https://github.com/owner/repository.git');
    const submit = wrapper.findAll('button').find((button) => button.text() === 'Clone repository')!;
    expect(submit.attributes('disabled')).toBeDefined();

    await wrapper.get('[aria-label="Repository URL"]').setValue('git@github.com:nbonamy/agent-workspace.git');
    expect(wrapper.get<HTMLInputElement>('[aria-label="Repository URL"]').element.checkValidity()).toBe(true);
    await submit.trigger('click');

    expect(wrapper.emitted('clone-url')).toStrictEqual([['git@github.com:nbonamy/agent-workspace.git']]);
  });
});
