import { computed, defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { WorkItem } from '@workspace/core/contracts';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import { backendChoicesKey } from '../backend-selection';
import { useWorkItemRouting } from '../use-work-item-routing';
import { useRepositorySession } from '../use-repository-session';
import RepositorySessionSourceDialog from '../RepositorySessionSourceDialog.vue';

afterEach(() => configureAppClient());

describe('Linear issue to repository session', () => {
  it('starts through the rendered picker with the current repository and remote host, then hands off the exact issue', async () => {
    const snapshot = createInitialSnapshot();
    const team = snapshot.teams[0]!;
    const createdAgent = { ...snapshot.agents[0]!, id: 'new-agent' };
    const issue: WorkItem = { provider: 'linear', id: 'linear:issue', identifier: 'ENG-12', number: 12, sourceId: 'linear:team',
      sourceName: 'Engineering', title: 'Fix login', body: 'Steps to reproduce', url: 'https://linear.app/acme/issue/ENG-12',
      state: 'open', labels: [], createdAt: '', updatedAt: '' };
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'linear', status: 'connected' }];
    api.getAutomationSnapshot.mockResolvedValue(snapshot);
    api.listWorkSources.mockResolvedValue([{ provider: 'linear', id: 'linear:team', name: 'Engineering', fullName: 'Engineering', owner: 'ENG', url: 'https://linear.app', isPrivate: true }]);
    api.listWorkItems.mockResolvedValue([issue]);
    const createWorktree = vi.fn().mockResolvedValue({ name: 'fix/eng-12', path: '/remote/code-eng-12' });
    const createAgent = vi.fn().mockResolvedValue(createdAgent);
    const assign = vi.fn().mockResolvedValue(undefined);
    let session!: ReturnType<typeof useRepositorySession>;
    const Host = defineComponent({
      components: { RepositorySessionSourceDialog },
      setup() {
        const routing = useWorkItemRouting({
          model: { snapshot: () => snapshot, activeTeamId: () => team.id, composerText: () => '', currentAgent: () => null, sourceRepositories: () => [] },
          actions: { assign, assignFromUi: vi.fn(), createAgent, createWorktree, createBranch: vi.fn(), duplicateAgent: vi.fn(), loadItems: vi.fn(), listBranches: vi.fn() },
          ui: { confirmReassignment: async () => true, focusComposer: vi.fn(), openNewAgent: vi.fn(), selectAgent: vi.fn(), updateComposer: vi.fn() },
        });
        session = useRepositorySession({ activeTeamId: () => team.id, getSnapshot: () => snapshot, getWorkRepositories: () => [],
          listSourceRepositories: async () => [],
          assignWorkItem: assign, createAgent, createIsolatedWorkItemAgent: routing.createIsolatedAgent, createSourceWorktree: createWorktree,
          listSourceBranches: async () => [{ name: 'main', isDefault: true }], loadWorkRepositories: async () => [], loadWorkItems: async () => [],
          notifyError: vi.fn(), prefillWorkItemForAgent: routing.prefill, startWorkItemInExistingSession: routing.startInExistingSession,
          suggestSourceWorktreePath: async () => '/remote/code-eng-12',
        });
        return { session };
      },
      template: `<RepositorySessionSourceDialog :visible="session.visible.value" repository-name="code" :branches="session.branches.value" :location="{ kind: 'remote', remoteConnectionId: 'remote-code' }" @start-work-item="session.startWork" @close="session.close" />`,
    });
    const wrapper = mount(Host, { global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex']) } } });
    await session.open({ repositoryRoot: '/remote/code', repositoryName: 'code', teamId: team.id, remoteConnectionId: 'remote-code' });
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    await wrapper.get('[aria-label="Team / project"] select').setValue('linear:team');
    await flushPromises();
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    await wrapper.get('.work-item-assignment-picker .app-button--primary').trigger('click');
    await flushPromises();
    expect(createWorktree).toHaveBeenCalledWith({ repoPath: '/remote/code', branchName: 'fix/eng-12', remoteConnectionId: 'remote-code' });
    expect(createAgent).toHaveBeenCalledWith({ name: null, folder: '/remote/code-eng-12', sourceRepositoryName: 'code', teamId: team.id, remoteConnectionId: 'remote-code', selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } });
    expect(assign).toHaveBeenCalledWith({ agentId: createdAgent.id, item: issue, prompt: expect.stringContaining('Issue: ENG-12') });
    expect(assign.mock.calls[0]![0].prompt).toContain(issue.body);
    expect(session.visible.value).toBe(false);
    expect(session.creationProgress.value).toMatchObject({ state: 'success', createWorktree: true, branchName: 'fix/eng-12', backend: 'codex', agentId: createdAgent.id });
  });
});
