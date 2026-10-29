import { reactive, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSidebarGroup } from '@workspace/core/workspace-sidebar';
import { useRepositorySessionMenu } from '../use-repository-session-menu';

const group: WorkspaceSidebarGroup = {
  id: 'git:/src/agent-workspace',
  kind: 'repository',
  label: 'app',
  repositoryRoot: '/src/agent-workspace',
  sessions: [{
    agentId: 'agent-one',
    customName: null,
    conversationTitle: null,
    displayTitle: 'main',
    branch: 'main',
    folder: '/src/agent-workspace',
    isLinkedWorktree: false,
    kind: 'main',
    isActive: true,
    isUnread: false,
    status: { type: 'idle' },
    quickSwitchIndex: 0,
  }],
};

describe('useRepositorySessionMenu', () => {
  it('loads and caches the default branch for a repository group', async () => {
    const load = vi.fn().mockResolvedValue([{ name: 'main', isDefault: true }]);
    const menu = useRepositorySessionMenu(() => load, translate);

    await menu.setVisible(group, true);
    await menu.setVisible(group, false);
    await menu.setVisible(group, true);

    expect(load).toHaveBeenCalledOnce();
    expect(menu.defaultBranches.value[group.id]).toStrictEqual({ name: 'main', isDefault: true });
  });

  it.each(['success', 'error', 'null'] as const)('replaces an open target and ignores its late %s response', async outcome => {
    const target = reactive({ ...group, remoteConnectionId: 'devbox' as string | undefined });
    let settle!: (value: { name: string; isDefault: boolean }[]) => void;
    let reject!: (error: Error) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise((yes, no) => { settle = yes; reject = no; }))
      .mockResolvedValueOnce([{ name: 'develop', isDefault: true }]);
    const menu = useRepositorySessionMenu(() => load, translate);
    const old = menu.setVisible(target, true);
    target.remoteConnectionId = undefined;
    target.repositoryRoot = '/local/repo';
    await nextTick();
    await menu.setVisible(target, true);
    expect(menu.defaultBranches.value[group.id]).toStrictEqual({ name: 'develop', isDefault: true });
    if (outcome === 'error') reject(new Error('old error'));
    else settle(outcome === 'null' ? [] : [{ name: 'main', isDefault: true }]);
    await old;
    expect(menu.defaultBranches.value[group.id]).toStrictEqual({ name: 'develop', isDefault: true });
    expect(menu.errors.value[group.id]).toBeNull();
    expect(menu.loading.value[group.id]).toBe(false);
  });

  it('does not reuse a cached null after the checkout target changes', async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'develop', isDefault: true }]);
    const menu = useRepositorySessionMenu(() => load, translate);
    await menu.setVisible(group, true);
    await menu.setVisible({ ...group, repositoryRoot: '/other' }, true);
    expect(menu.defaultBranches.value[group.id]?.name).toBe('develop');
  });

  it('captures loader failures and allows a later retry', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ name: 'main', isDefault: true }]);
    const menu = useRepositorySessionMenu(() => load, translate);

    await menu.setVisible(group, true);
    expect(menu.errors.value[group.id]).toBe('Could not load branches: offline');
    await menu.setVisible(group, true);

    expect(load).toHaveBeenCalledTimes(2);
    expect(menu.errors.value[group.id]).toBeNull();
  });
});

function translate(key: string, params?: Record<string, string>): string {
  return key === 'errors.branchesLoadWithDetail'
    ? `Could not load branches: ${params?.detail ?? ''}`
    : 'Could not load branches.';
}
