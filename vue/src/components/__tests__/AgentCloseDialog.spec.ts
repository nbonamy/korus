import { mount } from '@vue/test-utils';
import { ElSwitch } from 'element-plus';
import { describe, expect, it } from 'vitest';
import AgentCloseDialog from '../AgentCloseDialog.vue';

const agent = {
  id: 'agent-dina',
  teamId: 'team-test',
  name: 'Dina',
  folder: '/repo-fix-gh-22',
  backend: 'codex' as const,
  status: { type: 'idle' as const },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const workflow = {
  repository: 'owner/repo',
  folder: agent.folder,
  isLinkedWorktree: true,
  branch: 'fix/gh-22',
  detached: false,
  remote: 'origin',
  upstream: 'origin/fix/gh-22',
  ahead: 0,
  behind: 0,
  files: [],
  stagedFiles: [],
  unstagedFiles: [],
  githubConnected: true,
};

describe('AgentCloseDialog', () => {
  it('hides remote deletion for an inherited base upstream and clears a stale remote deletion choice', async () => {
    const wrapper = mountDialog();
    await wrapper.get('.agent-close-dialog__remote .el-switch').trigger('click');
    await wrapper.setProps({ workflow: { ...workflow, upstream: 'origin/main', baseBranch: 'main' } });
    expect(wrapper.find('.agent-close-dialog__remote').exists()).toBe(false);
    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('delete-worktree')).toStrictEqual([[false, false]]);
  });

  it('requires an explicit discard choice before deleting a dirty worktree and resets it on reopening', async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ workflow: { ...workflow, files: [{ path: 'README.fr.md', indexStatus: '?', worktreeStatus: '?' }] } });
    expect(wrapper.get('.app-button--primary').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.agent-close-dialog__discard [role="switch"]').attributes('aria-checked')).toBe('false');
    await wrapper.get('.agent-close-dialog__discard .el-switch').trigger('click');
    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('delete-worktree')).toStrictEqual([[false, true]]);
    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    expect(wrapper.get('.app-button--primary').attributes('disabled')).toBeDefined();
    await wrapper.get('.app-button--secondary').trigger('click');
    expect(wrapper.emitted('keep-worktree')).toStrictEqual([[]]);
  });

  it('offers keeping or deleting the linked worktree and keeps remote deletion opt-in', async () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain('Close Dina?');
    expect(wrapper.text()).toContain('fix/gh-22');
    expect(wrapper.text()).toContain('Also delete origin/fix/gh-22');

    await wrapper.get('.agent-close-dialog__remote .el-switch').trigger('click');
    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('delete-worktree')).toStrictEqual([[true, false]]);
  });

  it('can close the agent while preserving the worktree', async () => {
    const wrapper = mountDialog();

    await wrapper.get('.app-button--secondary').trigger('click');

    expect(wrapper.emitted('keep-worktree')).toStrictEqual([[]]);
  });
});

function mountDialog() {
  return mount(AgentCloseDialog, {
    props: { visible: true, agent, workflow },
    global: {
      components: { ElSwitch },
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
