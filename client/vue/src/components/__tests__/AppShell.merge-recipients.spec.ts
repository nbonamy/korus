import { DOMWrapper, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { Agent, AgentGitWorkflow } from '@workspace/core/contracts';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { mountShell } from './app-shell-test-harness';

afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); document.body.innerHTML = ''; });

it('lists merge recipients in manual sidebar order and retains the selected recipient after reordering', async () => {
  const snapshot = createInitialSnapshot();
  const source = snapshot.agents[0]!;
  source.folder = '/repo-feature';
  source.workspace = { kind: 'git', folder: source.folder, repositoryName: 'repo', repositoryRoot: source.folder,
    primaryWorktreeRoot: '/repo', branch: 'feature', isLinkedWorktree: true, updatedAt: '' };
  const peers: Agent[] = ['Alpha', 'Beta', 'Gamma'].map(name => ({ ...source, id: name.toLowerCase(), name }));
  snapshot.agents = [source, ...peers];
  snapshot.teams[0]!.agentIds = ['gamma', source.id, 'alpha', 'beta'];
  window.localStorage.setItem(`app:agentOrganization:${source.teamId}`, 'repository');
  const workflow: AgentGitWorkflow = { repository: 'repo', folder: source.folder, isLinkedWorktree: true, baseBranch: 'main', branch: 'feature',
    detached: false, remote: 'origin', ahead: 1, behind: 0, stagedAddedLines: 0, stagedRemovedLines: 0, unstagedAddedLines: 0, unstagedRemovedLines: 0,
    untrackedAddedLines: 0, untrackedRemovedLines: 0, files: [], stagedFiles: [], unstagedFiles: [], githubConnected: true };
  const merge = vi.fn().mockResolvedValue(workflow);
  const wrapper = mountShell({ snapshot, realAgentSidebar: true, stubRightWorkspacePanel: true,
    getAgentGitWorkflow: async () => workflow, mergeAgentGitBranch: merge });
  await flushPromises();
  const sidebarNames = () => wrapper.findAll('.agent-sidebar__session-title').map(row => row.text()).filter(name => ['Alpha', 'Beta', 'Gamma'].includes(name));
  expect(sidebarNames()).toStrictEqual(['Gamma', 'Alpha', 'Beta']);
  await wrapper.get('.git-workflow-control__trigger').trigger('click');
  await wrapper.findAll('[role="menuitem"]').find(item => item.text().trim() === 'Merge')!.trigger('click');
  await flushPromises();
  const dialog = new DOMWrapper(document.body).get('.git-workflow-control__dialog');
  await dialog.get<HTMLInputElement>('[role="switch"][aria-label="Report to another agent"]').setValue(true);
  const options = () => dialog.findAll('[aria-label="Report recipient"] option').map(option => option.text());
  expect(options()).toStrictEqual(sidebarNames());
  await dialog.get('[aria-label="Report recipient"] select').setValue('alpha');

  const reordered = { ...snapshot, teams: snapshot.teams.map(team => ({ ...team, agentIds: ['beta', 'gamma', source.id, 'alpha'] })) };
  await wrapper.setProps({ snapshot: reordered }); await flushPromises();
  expect(sidebarNames()).toStrictEqual(['Beta', 'Gamma', 'Alpha']);
  expect(options()).toStrictEqual(sidebarNames());
  expect(dialog.get<HTMLSelectElement>('[aria-label="Report recipient"] select').element.value).toBe('alpha');
  expect(merge).not.toHaveBeenCalled();
  wrapper.unmount();
});
