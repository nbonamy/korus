import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentGitLogPage } from '@workspace/core/contracts';
import { stubElectronTestWindow } from '../../test/client';
import GitLogPanel from '../GitLogPanel.vue';

const agent = { id: 'a', teamId: 'team', folder: '/repo', status: { type: 'idle' } } as Agent;
const sha = 'a'.repeat(40);
const commit = { sha, subject: 'fix: visible history', author: 'Nicolas', date: new Date().toISOString() };
const page: AgentGitLogPage = { repository: 'repo', branch: 'feature', head: sha, commits: [commit], nextCursor: { head: sha, offset: 50, search: '' } };
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); });
function render() { const wrapper = mount(GitLogPanel, { props: { agent, branch: 'feature' } }); wrappers.push(wrapper); return wrapper; }

describe('Git log inline history', () => {
  it('pages, expands full commit details, copies the full hash, and loads a selected historical file inline', async () => {
    const getAgentGitLog = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, commits: [{ ...commit, sha: 'b'.repeat(40), subject: 'older' }], nextCursor: undefined });
    const getAgentGitLogCommit = vi.fn().mockResolvedValue({ ...commit, message: 'fix: visible history\n\nFull body', files: [{ path: 'file.ts', status: 'M', addedLines: 1, removedLines: 1, binary: false }], filesTruncated: false });
    const getAgentGitLogFile = vi.fn().mockResolvedValue({ diff: 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+historical\n' });
    stubElectronTestWindow({ app: { getAgentGitLog, getAgentGitLogCommit, getAgentGitLogFile } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const wrapper = render(); await flushPromises();
    expect(wrapper.text()).toContain('Today');
    expect(wrapper.text()).toContain('feature');
    await wrapper.get('[aria-label="Load older commits"]').trigger('click'); await flushPromises();
    expect(getAgentGitLog).toHaveBeenLastCalledWith('a', { search: '', cursor: page.nextCursor });
    expect(wrapper.text()).toContain('older');
    await wrapper.get('.git-log-panel__commit').trigger('click'); await flushPromises();
    expect(getAgentGitLogCommit).toHaveBeenCalledExactlyOnceWith('a', { head: sha, sha });
    expect(wrapper.text()).toContain('Full body');
    await wrapper.get('[aria-label="Copy commit hash"]').trigger('click');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(sha);
    await wrapper.get('[aria-label="View changes in file.ts"]').trigger('click'); await flushPromises();
    expect(getAgentGitLogFile).toHaveBeenCalledExactlyOnceWith('a', { head: sha, sha, path: 'file.ts' });
    expect(wrapper.text()).toContain('historical');
    await wrapper.get('.git-log-panel__commit').trigger('click');
    expect(wrapper.text()).not.toContain('Full body');
  });

  it('invalidates pending results immediately when searching or changing agent and branch', async () => {
    vi.useFakeTimers();
    let resolveOld!: (page: AgentGitLogPage) => void;
    const getAgentGitLog = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ ...page, repository: 'second', commits: [{ ...commit, subject: 'new result' }] });
    stubElectronTestWindow({ app: { getAgentGitLog } });
    const wrapper = render();
    await wrapper.get('input').setValue('new');
    resolveOld(page); await flushPromises();
    expect(wrapper.text()).not.toContain('fix: visible history');
    await vi.advanceTimersByTimeAsync(250); await flushPromises();
    expect(getAgentGitLog).toHaveBeenLastCalledWith('a', { search: 'new' });
    await wrapper.setProps({ agent: { ...agent, id: 'b', folder: '/second' }, branch: 'other' }); await flushPromises();
    expect(getAgentGitLog).toHaveBeenLastCalledWith('b', { search: '' });
    expect(wrapper.text()).toContain('new result');
  });

  it('recovers read errors through refresh and shows an empty search distinctly', async () => {
    const getAgentGitLog = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...page, commits: [], nextCursor: undefined });
    stubElectronTestWindow({ app: { getAgentGitLog } });
    const wrapper = render(); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to load Git history');
    await wrapper.get('[aria-label="Refresh Git log"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('No commits yet');
    await wrapper.get('input').setValue('missing');
    await new Promise(resolve => setTimeout(resolve, 280)); await flushPromises();
    expect(wrapper.text()).toContain('No matching commits');
  });
  it('keeps late commit and file reads out of a newer inline selection', async () => {
    const other = { ...commit, sha: 'b'.repeat(40), subject: 'second commit' };
    let finishDetails!: (value: unknown) => void;
    let finishFile!: (value: { diff: string }) => void;
    const files = [{ path: 'one.ts', status: 'M', addedLines: 1, removedLines: 0, binary: false }, { path: 'two.ts', status: 'M', addedLines: 1, removedLines: 0, binary: false }];
    const getAgentGitLogCommit = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishDetails = resolve; })).mockResolvedValue({ ...other, message: 'Second details', files, filesTruncated: false });
    const getAgentGitLogFile = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFile = resolve; })).mockResolvedValue({ diff: 'diff --git a/two.ts b/two.ts\n--- a/two.ts\n+++ b/two.ts\n@@ -0,0 +1 @@\n+selected file\n' });
    stubElectronTestWindow({ app: { getAgentGitLog: vi.fn().mockResolvedValue({ ...page, commits: [commit, other] }), getAgentGitLogCommit, getAgentGitLogFile } });
    const wrapper = render(); await flushPromises();
    await wrapper.findAll('.git-log-panel__commit')[0]!.trigger('click');
    await wrapper.findAll('.git-log-panel__commit')[1]!.trigger('click'); await flushPromises();
    finishDetails({ ...commit, message: 'Stale details', files, filesTruncated: false }); await flushPromises();
    expect(wrapper.text()).toContain('Second details');
    expect(wrapper.text()).not.toContain('Stale details');
    await wrapper.get('[aria-label="View changes in one.ts"]').trigger('click');
    await wrapper.get('[aria-label="View changes in two.ts"]').trigger('click'); await flushPromises();
    finishFile({ diff: 'stale file content' }); await flushPromises();
    expect(wrapper.text()).toContain('selected file');
    expect(wrapper.text()).not.toContain('stale file content');
  });

});
