import { flushPromises, shallowMount } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { describe, expect, it } from 'vitest';
import FirstRunOnboardingGate from '../FirstRunOnboardingGate.vue';

function mountGate(overrides: Partial<InstanceType<typeof FirstRunOnboardingGate>['$props']> = {}) {
  return shallowMount(FirstRunOnboardingGate, {
    props: {
      authentication: null,
      claudeDialogVisible: false,
      codexConnected: false,
      claudeConnected: false,
      claudeLoading: false,
      claudeError: null,
      continuing: false,
      authenticationCancelling: false,
      authenticationError: null,
      authenticationLoading: false,
      repositoriesOnboardingVisible: false,
      initialAuthenticationLoading: false,
      onboardingCompleteVisible: false,
      connectRepositoryProvider: async () => {},
      disconnectRepositoryProvider: async () => {},
      openRepositoryAuthorization: async () => {},
      showLoginLanding: false,
      snapshot: createInitialSnapshot(),
      workProviderAuthorizations: {},
      ...overrides,
    },
    global: { stubs: { LocalClaudeAuthenticationDialog: false, FormDialog: false, FormField: false, teleport: true } },
  });
}

describe('FirstRunOnboardingGate', () => {
  it('keeps the default login environment unset instead of falling back to an explicit home', async () => {
    const wrapper = mountGate({
      claudeDialogVisible: true,
      claudeAuthentication: { loggedIn: false, configDirectory: null },
      providerSetup: [{ backend: 'claude', installed: true, isolated: false, shareSkills: true, locked: false, homePath: '/users/test/.claude' }],
    });
    await flushPromises();
    expect(wrapper.findAll('code').map(command => command.text())).toStrictEqual([
      'env -u CLAUDE_CONFIG_DIR claude auth login --claudeai',
      'env -u CLAUDE_CONFIG_DIR claude auth login --console',
    ]);
  });

  it('gives ChatGPT sign-in precedence and forwards its actions', () => {
    const wrapper = mountGate({
      repositoriesOnboardingVisible: true,
      showLoginLanding: true,
    });
    const landing = wrapper.getComponent({ name: 'CodexLoginLanding' });

    landing.vm.$emit('login');
    landing.vm.$emit('cancel');

    expect(wrapper.findComponent({ name: 'RepositoryOnboardingLanding' }).exists()).toBe(false);
    expect(wrapper.emitted('login')).toStrictEqual([[]]);
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
  });

  it('routes the optional repository step and completion state', async () => {
    const wrapper = mountGate({ repositoriesOnboardingVisible: true });
    const github = wrapper.getComponent({ name: 'RepositoryOnboardingLanding' });

    github.vm.$emit('continue');
    expect(wrapper.emitted('complete')).toStrictEqual([[]]);

    await wrapper.setProps({
      repositoriesOnboardingVisible: false,
      onboardingCompleteVisible: true,
    });
    wrapper.getComponent({ name: 'OnboardingCompleteLanding' }).vm.$emit('complete');
    expect(wrapper.emitted('finish')).toStrictEqual([[]]);
  });
});
