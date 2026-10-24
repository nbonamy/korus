import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox, ElTabs, ElTabPane, ElPopover, ElDialog } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '../SettingsView.vue';
import type { AppApi } from '@workspace/core/contracts';
import { defaultGeneralSettings, defaultThemeSettings } from '@workspace/core/settings';
import { configureAppClient } from '../../platform-api';
import { setElectronTestClient } from '../../test/client';
import { curatedSkills, type SkillManagerState } from '@workspace/core/skill-manager';

describe('SettingsView', () => {
  it('installs a featured skill, offers whole packs, syncs providers and keeps failures visible', async () => {
    const personal = { name: 'personal-notes', description: 'My private checklist', managed: false, providers: [{ backend: 'codex' as const, path: '/codex/skills/personal-notes', status: 'installed' as const }, { backend: 'claude' as const, path: '/claude/skills/personal-notes', status: 'missing' as const }] };
    const nativeGuidelines = { ...personal, name: 'web-design-guidelines', providers: personal.providers.map(provider => ({ ...provider, status: 'installed' as const })) };
    const system = { ...personal, name: 'system-tool', builtIn: true };
    const initial: SkillManagerState = { skills: [personal, nativeGuidelines, system], providers: ['codex', 'claude'], curated: curatedSkills, issues: [] };
    const skill = { name: 'security-audit', managed: true, description: 'Security audit', source: 'https://github.com/cloudflare/security-audit-skill', revision: 'a'.repeat(40), providers: [{ backend: 'codex' as const, path: '/codex/skills/security-audit', status: 'installed' as const }] };
    const installed = { ...initial, skills: [...initial.skills, skill] };
    const manageSkills = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(installed)
      .mockResolvedValueOnce({ ...installed, issues: ['Claude: existing personal skill was preserved'] })
      .mockRejectedValueOnce(new Error('GitHub download failed')).mockResolvedValue(installed);
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    expect(wrapper.findAll('[role="tab"]')[0]!.text()).toBe('Discover');
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true');
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    expect(wrapper.text()).toContain('personal-notes');
    expect(wrapper.find('[aria-label="personal-notes actions"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="system-tool actions"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Skill type"] select').setValue('builtIn');
    await wrapper.get('[aria-label="system-tool actions"]').trigger('click'); await flushPromises();
    expect(skillMenuButton('system-tool', 'Delete skill')!.disabled).toBe(true);
    await wrapper.get('[aria-label="system-tool actions"]').trigger('keydown', { key: 'Escape' });
    await wrapper.get('[aria-label="Skill type"] select').setValue('personal');
    expect(wrapper.get('[aria-label="Claude Code: not installed"]').attributes('role')).toBe('img');
    expect(wrapper.findAll('[role="columnheader"]').map(header => header.text())).not.toContain('Codex');
    expect(wrapper.get('[aria-label="Codex: installed"]').attributes('title')).toContain('Codex: installed');
    await wrapper.get('[aria-label="Search skills"]').setValue('no such skill');
    expect(wrapper.text()).not.toContain('personal-notes');
    await wrapper.get('[aria-label="Search skills"]').setValue('');
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toContain('Discover');
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Discover')!.trigger('click');
    expect(wrapper.get('[data-skill="web-design-guidelines"] button').attributes('aria-label')).toBe('Uninstall Web design guidelines');
    const card = wrapper.get('[data-skill="security-audit"]');
    await card.get('button').trigger('click'); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'install', source: curatedSkills.find(skill => skill.name === 'security-audit')!.source });
    expect(card.get('button').text()).toBe('Refresh');
    const syncConfirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never);
    const beforeSync = manageSkills.mock.calls.length;
    await wrapper.get('[aria-label="Sync skills"]').trigger('click'); await flushPromises();
    expect(syncConfirm).toHaveBeenCalledWith('This makes all your personal skills available in all your configured coding agents.', 'Sync skills?', expect.objectContaining({ confirmButtonText: 'Sync' }));
    expect(manageSkills).toHaveBeenCalledTimes(beforeSync);
    await wrapper.get('[aria-label="Sync skills"]').trigger('click'); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'sync' });
    expect(wrapper.get('[role="alert"]').text()).toContain('personal skill was preserved');
    await wrapper.get('[data-skill="matt-pocock"] button').trigger('click'); await flushPromises();
    expect(manageSkills).toHaveBeenNthCalledWith(4, { action: 'install', source: curatedSkills.find(skill => skill.name === 'matt-pocock')!.source });
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'list' });
    expect(wrapper.get('[role="alert"]').text()).toContain('GitHub download failed');
    expect(wrapper.get('[data-skill="matt-pocock"] button').attributes('disabled')).toBeUndefined();
    await wrapper.findAll('button').find(button => button.text() === 'Install skill')!.trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Skill source"]').setValue('  https://github.com/example/skills  ');
    await wrapper.get('#skill-source-form').trigger('submit'); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'install', source: 'https://github.com/example/skills' });
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    manageSkills.mockResolvedValueOnce({ ...installed, document: { name: 'personal-notes', files: [{ providers: ['codex'], content: '# Private checklist\n\nCheck the release.' }] } });
    await wrapper.get('[aria-label="personal-notes actions"]').trigger('click'); await flushPromises();
    skillMenuButton('personal-notes', 'View skill')!.click(); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'view', name: 'personal-notes' });
    expect(wrapper.findAll('[role="dialog"]').some(dialog => dialog.text().includes('Check the release.'))).toBe(true);
    await wrapper.findAll('button').find(button => button.text() === 'Close')!.trigger('click');
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never);
    await wrapper.get('[aria-label="personal-notes actions"]').trigger('click'); await flushPromises();
    const beforeCancel = manageSkills.mock.calls.length;
    skillMenuButton('personal-notes', 'Delete skill')!.click(); await flushPromises();
    expect(manageSkills).toHaveBeenCalledTimes(beforeCancel);
    manageSkills.mockResolvedValueOnce({ ...installed, skills: installed.skills.filter(skill => skill.name !== 'personal-notes') });
    await wrapper.get('[aria-label="personal-notes actions"]').trigger('click'); await flushPromises();
    skillMenuButton('personal-notes', 'Delete skill')!.click(); await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(4); // two Sync prompts, then two Delete prompts
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'remove', name: 'personal-notes', confirmed: true });
    expect(wrapper.find('[aria-label="personal-notes actions"]').exists()).toBe(false);

  });
  it('shows the featured skills at once and a placeholder for the installed list while it loads', async () => {
    let resolveList!: (state: SkillManagerState) => void;
    const manageSkills = vi.fn().mockReturnValueOnce(new Promise<SkillManagerState>((resolve) => { resolveList = resolve; }));
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    expect(wrapper.findAll('[data-skill]')).toHaveLength(curatedSkills.length);
    expect(wrapper.get('[data-skill="security-audit"] button').attributes('disabled')).toBeDefined();
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    expect(wrapper.get('[aria-label="Loading skills…"]').attributes('aria-busy')).toBe('true');
    resolveList({ skills: [], providers: ['codex'], curated: curatedSkills, issues: [] });
    await flushPromises();
    expect(wrapper.find('[aria-label="Loading skills…"]').exists()).toBe(false);
    expect(wrapper.get('[data-skill="security-audit"] button').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('labels where a skill came from and opens a skill right away while its document loads', async () => {
    const providers = [{ backend: 'codex' as const, path: '/codex/skills/built-in-browser', status: 'installed' as const }];
    const base = { description: 'Browser pane', managed: false, providers };
    const initial: SkillManagerState = {
      skills: [{ ...base, name: 'built-in-browser', builtIn: true }, { ...base, name: 'notes' }, { ...base, name: 'imagegen', builtIn: true }, { ...base, name: 'copied', origin: 'synced' }],
      providers: ['codex'], curated: curatedSkills, issues: [],
    };
    let resolveView!: (state: SkillManagerState) => void;
    const manageSkills = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(new Promise<SkillManagerState>((resolve) => { resolveView = resolve; }));
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    expect(wrapper.find('[aria-label="notes actions"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="copied actions"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="built-in-browser actions"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Personal');
    expect(wrapper.text()).toContain('Synced');
    await wrapper.get('[aria-label="Skill type"] select').setValue('builtIn');
    expect(wrapper.find('[aria-label="built-in-browser actions"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="imagegen actions"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="notes actions"]').exists()).toBe(false);
    expect(wrapper.findAll('.settings-skills__origin').map(label => label.text())).toEqual(['Built-in', 'Built-in']);
    await wrapper.get('[aria-label="Skill type"] select').setValue('personal');
    await wrapper.get('[aria-label="notes actions"]').trigger('click'); await flushPromises();
    skillMenuButton('notes', 'View skill')!.click(); await flushPromises();
    const dialog = () => wrapper.findAll('[role="dialog"]').find(candidate => candidate.text().startsWith('notes'));
    expect(dialog()).toBeDefined();
    expect(dialog()!.get('[aria-label="Loading skill…"]').attributes('aria-busy')).toBe('true');
    resolveView({ ...initial, document: { name: 'notes', files: [{ providers: ['codex'], content: '# Notes' }] } });
    await flushPromises();
    expect(dialog()!.find('[aria-label="Loading skill…"]').exists()).toBe(false);
    expect(dialog()!.get('.settings-skills__body h1').text()).toBe('Notes');
    wrapper.unmount();
  });

  it('shows a skill as its name, description and rendered Markdown instead of raw front matter', async () => {
    const providers = [{ backend: 'codex' as const, path: '/codex/skills/review', status: 'installed' as const }];
    const initial: SkillManagerState = { skills: [{ name: 'review', description: 'Review a change.', managed: false, providers }], providers: ['codex'], curated: curatedSkills, issues: [] };
    const manageSkills = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, document: { name: 'review', files: [{ providers: ['codex'], content: '---\nname: review\ndescription: Review a change.\nlicense: MIT\n---\n# Steps\n\nRead the **diff** first.\n' }] } });
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    await wrapper.get('[aria-label="review actions"]').trigger('click'); await flushPromises();
    skillMenuButton('review', 'View skill')!.click(); await flushPromises();
    const viewer = wrapper.get('.settings-skills__viewer');
    expect(wrapper.findAll('[role="dialog"]').some(dialog => dialog.text().startsWith('review') && !dialog.text().includes('SKILL.md'))).toBe(true);
    expect(viewer.find('h3').exists()).toBe(false);
    expect(viewer.get('.settings-skills__summary').text()).toBe('Review a change.');
    expect(viewer.get('.settings-skills__body h1').text()).toBe('Steps');
    expect(viewer.get('.settings-skills__body strong').text()).toBe('diff');
    expect(viewer.text()).not.toContain('license');
    expect(viewer.text()).not.toContain('---');
    wrapper.unmount();
  });

  it('shows a spinner on the skill that is being deleted', async () => {
    const providers = [{ backend: 'codex' as const, path: '/codex/skills/notes', status: 'installed' as const }];
    const skills = ['notes', 'other'].map(name => ({ name, description: name, managed: false, providers }));
    const initial: SkillManagerState = { skills, providers: ['codex'], curated: curatedSkills, issues: [] };
    let finishRemove!: (state: SkillManagerState) => void;
    const manageSkills = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(new Promise<SkillManagerState>((resolve) => { finishRemove = resolve; }));
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce('confirm' as never);
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    await wrapper.get('[aria-label="notes actions"]').trigger('click'); await flushPromises();
    skillMenuButton('notes', 'Delete skill')!.click(); await flushPromises();
    expect(wrapper.get('[aria-label="Deleting notes…"]').attributes('role')).toBe('status');
    expect(wrapper.find('[aria-label="notes actions"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Deleting other…"]').exists()).toBe(false);
    finishRemove({ ...initial, skills: [skills[1]!] });
    await flushPromises();
    expect(wrapper.find('[aria-label="Deleting notes…"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('installs for every coding agent unless some are unselected in the install dialog', async () => {
    const initial: SkillManagerState = { skills: [], providers: ['codex', 'claude'], curated: curatedSkills, issues: [] };
    const manageSkills = vi.fn().mockResolvedValue(initial);
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Install skill')!.trigger('click'); await flushPromises();
    const agents = () => wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('aria-label') === 'Coding agents')!;
    expect(agents().props('modelValue')).toEqual(['codex', 'claude']);
    await wrapper.get('[aria-label="Skill source"]').setValue('https://github.com/example/skills');
    await agents().vm.$emit('update:modelValue', ['codex']);
    await wrapper.get('#skill-source-form').trigger('submit'); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'install', source: 'https://github.com/example/skills', backends: ['codex'] });
    await wrapper.findAll('button').find(button => button.text() === 'Install skill')!.trigger('click'); await flushPromises();
    expect(agents().props('modelValue')).toEqual(['codex', 'claude']);
    await wrapper.get('[aria-label="Skill source"]').setValue('https://github.com/example/skills');
    await agents().vm.$emit('update:modelValue', []);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('syncs just one personal skill from its menu, with a spinner on that row, and offers it for no built-in skill', async () => {
    const providers = [{ backend: 'codex' as const, path: '/codex/skills/notes', status: 'installed' as const }, { backend: 'claude' as const, path: '/claude/skills/notes', status: 'missing' as const }];
    const skills = [{ name: 'notes', description: 'Notes', managed: false, providers }, { name: 'imagegen', description: 'Images', managed: false, builtIn: true, providers }];
    const initial: SkillManagerState = { skills, providers: ['codex', 'claude'], curated: curatedSkills, issues: [] };
    let finishSync!: (state: SkillManagerState) => void;
    const manageSkills = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(new Promise<SkillManagerState>((resolve) => { finishSync = resolve; }));
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    await wrapper.findAll('[role="tab"]').find(tab => tab.text().startsWith('Installed'))!.trigger('click');
    await wrapper.get('[aria-label="notes actions"]').trigger('click'); await flushPromises();
    const labels = [...document.body.querySelectorAll('[aria-label="notes actions"][role="menu"] button')].map(button => button.textContent?.trim());
    expect(labels.slice(0, 2)).toEqual(['View skill', 'Sync this skill']);
    skillMenuButton('notes', 'Sync this skill')!.click(); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'sync', name: 'notes' });
    expect(wrapper.get('[aria-label="Syncing notes…"]').attributes('role')).toBe('status');
    finishSync(initial); await flushPromises();
    expect(wrapper.find('[aria-label="Syncing notes…"]').exists()).toBe(false);
    await wrapper.get('[aria-label="Skill type"] select').setValue('builtIn');
    await wrapper.get('[aria-label="imagegen actions"]').trigger('click'); await flushPromises();
    expect(skillMenuButton('imagegen', 'Sync this skill')).toBeUndefined();
    wrapper.unmount();
  });

  it('offers Refresh and an icon-only Uninstall for what Korus installed, and removes exactly the skills a pack recorded', async () => {
    const skill = (name: string, extra = {}) => ({ name, description: name, managed: true, source: 'https://github.com/mattpocock/skills', revision: 'a'.repeat(40), providers: [{ backend: 'codex' as const, path: `/codex/skills/${name}`, status: 'installed' as const }], ...extra });
    const installed: SkillManagerState = { skills: [skill('tdd'), skill('triage'), skill('mine', { managed: false })], providers: ['codex'], curated: curatedSkills, issues: [], installs: { 'matt-pocock': ['tdd', 'triage', 'long-gone'] } };
    const manageSkills = vi.fn().mockResolvedValueOnce(installed).mockResolvedValueOnce(installed).mockResolvedValueOnce({ ...installed, skills: [skill('mine', { managed: false })], installs: {} });
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as never);
    setElectronTestClient({ manageSkills });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    const buttons = (name: string) => wrapper.findAll(`[data-skill="${name}"] .settings-skills__actions button`);
    expect(buttons('matt-pocock').map(button => button.text() || button.attributes('aria-label'))).toEqual(['Refresh', 'Uninstall Matt Pocock’s skills']);
    expect(buttons('pstack').map(button => button.text())).toEqual(['Install pack']);
    await buttons('matt-pocock')[0]!.trigger('click'); await flushPromises();
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'install', source: curatedSkills.find(entry => entry.name === 'matt-pocock')!.source, refresh: true });
    await buttons('matt-pocock')[1]!.trigger('click'); await flushPromises();
    expect(manageSkills).toHaveBeenCalledTimes(2);
    await buttons('matt-pocock')[1]!.trigger('click'); await flushPromises();
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('tdd, triage'), 'Uninstall Matt Pocock’s skills?', expect.anything());
    expect(manageSkills).toHaveBeenLastCalledWith({ action: 'remove', names: ['tdd', 'triage'], confirmed: true });
    expect(buttons('matt-pocock').map(button => button.text())).toEqual(['Install pack']);
    wrapper.unmount();
  });

  it('does not offer Refresh for a skill Korus did not install', async () => {
    const providers = [{ backend: 'codex' as const, path: '/codex/skills/security-audit', status: 'installed' as const }];
    const initial: SkillManagerState = { skills: [{ name: 'security-audit', description: 'Mine', managed: false, providers }], providers: ['codex'], curated: curatedSkills, issues: [] };
    setElectronTestClient({ manageSkills: vi.fn().mockResolvedValue(initial) });
    const wrapper = mount(SettingsView, { attachTo: document.body, props: { activeTab: 'skills', settings: defaultThemeSettings }, global: { components: { ElTabs, ElTabPane, ElPopover, ElDialog } } });
    await flushPromises();
    const actions = wrapper.findAll('[data-skill="security-audit"] .settings-skills__actions button');
    expect(actions.map(button => button.attributes('aria-label') ?? button.text())).toEqual(['Uninstall Security audit']);
    wrapper.unmount();
  });

  it('keeps GitHub and Linear connection buttons independent of backlog loading and each other', async () => {
    let finishGitHub!: () => void;
    let finishLinear!: () => void;
    const connect = vi.fn((provider: string) => new Promise<void>(resolve => {
      if (provider === 'github') finishGitHub = resolve;
      else finishLinear = resolve;
    }));
    const wrapper = mount(SettingsView, { props: {
      activeTab: 'integrations', settings: defaultThemeSettings, generalSettings: defaultGeneralSettings,
      workBacklogStatus: 'loading',
      workBacklogConnections: [{ provider: 'github', source: 'cli', status: 'connected' }, { provider: 'linear', status: 'disconnected' }],
      connectWorkProvider: connect,
    } });
    const github = wrapper.get('[aria-label="Connect GitHub"]');
    const linear = wrapper.get('[aria-label="Connect Linear"]');
    expect(github.attributes('disabled')).toBeUndefined();
    expect(linear.attributes('disabled')).toBeUndefined();
    expect(wrapper.find('[aria-label="Disconnect GitHub"]').exists()).toBe(false);
    expect(wrapper.get('.status-pill--warning').text()).toBe('Using GitHub CLI');
    await github.trigger('click');
    expect(github.attributes('disabled')).toBeDefined();
    expect(linear.attributes('disabled')).toBeUndefined();
    await linear.trigger('click');
    expect(connect.mock.calls).toStrictEqual([['github'], ['linear']]);
    finishGitHub(); await flushPromises();
    expect(github.attributes('disabled')).toBeUndefined();
    expect(linear.attributes('disabled')).toBeDefined();
    finishLinear(); await flushPromises();
    expect(linear.attributes('disabled')).toBeUndefined();
  });

  it('places Workflows in Workspace and opens its Delegation section with saved preferences', () => {
    setElectronTestClient({});
    const wrapper = mount(SettingsView, { props: {
      activeTab: 'workflows', settings: defaultThemeSettings,
      generalSettings: { ...defaultGeneralSettings, worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: 'Run focused tests' },
    } });
    const workspace = wrapper.findAll('.el-menu-item-group').find(group => group.get('.el-menu-item-group__title').text() === 'Workspace')!;
    expect(workspace.text()).toContain('Workflows');
    expect(wrapper.get('h2').text()).toBe('Workflows');
    expect(wrapper.findAll('h3').map(heading => heading.text())).toContain('Delegation');
    expect((wrapper.get('[aria-label="Delegation instructions"]').element as HTMLTextAreaElement).value).toBe('Run focused tests');
  });
  it('uses daemon availability for gated settings and falls back from a saved unavailable tab', async () => {
    setElectronTestClient({});
    const connectAntigravity = vi.fn();
    const installProvider = vi.fn().mockResolvedValue(undefined);
    const refreshProvider = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsView, { props: {
      activeTab: 'antigravity', settings: defaultThemeSettings,
      generalSettings: { ...defaultGeneralSettings, providerEnabled: { antigravity: true } },
      providerConnections: [], connectAntigravity, refreshProvider, installProvider,
    } });
    expect(wrapper.text()).not.toContain('Antigravity');
    expect(wrapper.text()).toContain('Accessibility');
    await wrapper.setProps({ providerConnections: [{ backend: 'antigravity', installed: false, connected: false, checking: false }] });
    expect(wrapper.get('.engine-hero__copy strong').text()).toBe('Antigravity');
    await wrapper.get('button[aria-label="Install Antigravity"]').trigger('click');
    expect(installProvider).toHaveBeenCalledExactlyOnceWith('antigravity');
    await wrapper.get('button[aria-label="Check again"]').trigger('click');
    expect(refreshProvider).toHaveBeenCalledWith('antigravity');
    expect(connectAntigravity).not.toHaveBeenCalled();
    await wrapper.setProps({ providerConnections: [{ backend: 'antigravity', installed: true, connected: false, checking: false }] });
    await wrapper.findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
    expect(connectAntigravity).toHaveBeenCalledOnce();
    const agentGroup = wrapper.findAll('.el-menu-item-group').find(group => group.get('.el-menu-item-group__title').text() === 'Agents')!;
    const antigravityTab = agentGroup.findAll('.el-menu-item').find(item => item.text() === 'Antigravity')!;
    await antigravityTab.trigger('click');
    await wrapper.findAll('.el-menu-item').find(item => item.text() === 'Voice')!.trigger('click');
    expect(wrapper.emitted('selectTab')).toStrictEqual([['antigravity'], ['voice']]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens on General by default, preserves the settings order, and emits tab selections', async () => {
    setElectronTestClient({});
    const wrapper = mount(SettingsView, {
      attachTo: document.body,
      props: {
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain('Accessibility');
    expect(wrapper.findAll('.el-menu-item').map((item) => item.text())).toStrictEqual([
      'General',
      'Analytics',
      'Appearance',
      'Voice',
      'Personalization',
      'Screenshots',
      'Codex',
      'Claude Code',
      'Skills',
      'Plugins',
      'Git',
      'Workflows',
      'Integrations',
      'Connections',
    ]);
    expect(wrapper.findAll('.el-menu-item-group__title').map((title) => title.text())).toStrictEqual(['App', 'Agents', 'Workspace']);
    expect(wrapper.text()).not.toContain('Launch ChatGPT');
    expect(wrapper.text()).not.toContain('Enable Claude Code');
    expect(wrapper.text()).not.toContain('Theme');
    const menuItems = wrapper.findAll('.el-menu-item');
    for (const label of ['Codex', 'Claude Code']) {
      const item = menuItems.find((item) => item.text() === label)!;
      const icon = item.get('.backend-icon');
      expect(getComputedStyle(icon.element).transform).toBe('scale(1.15)');
      for (const color of ['rgb(120, 120, 120)', 'rgb(220, 220, 220)']) {
        (item.element as HTMLElement).style.color = color;
        expect(getComputedStyle(icon.element).backgroundColor).toBe(color);
      }
      expect(getComputedStyle(icon.element).maskImage).toContain('url(');
    }
    expect(menuItems.find((item) => item.text() === 'Plugins')?.get('svg').html())
      .not.toBe(menuItems.find((item) => item.text() === 'Integrations')?.get('svg').html());

    await wrapper.findAll('.el-menu-item').find((item) => item.text() === 'Appearance')?.trigger('click');

    expect(wrapper.emitted('selectTab')).toStrictEqual([['appearance']]);
  });

  it('routes Codex and Claude Code controls to separate provider panels', async () => {
    setElectronTestClient({});
    const connectCodex = vi.fn().mockResolvedValue(undefined);
    const connectClaude = vi.fn().mockResolvedValue(undefined);
    const setProviderEnabled = vi.fn().mockResolvedValue(undefined);
    const disconnectProvider = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsView, {
      props: {
        activeTab: 'codex',
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        connectCodex, connectClaude, setProviderEnabled, disconnectProvider,
        providerConnections: (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: false, checking: false })),
      },
    });

    expect(wrapper.text()).toContain('Launch ChatGPT');
    expect(wrapper.text()).not.toContain('Share skills and plugins with ChatGPT');
    expect(wrapper.text()).not.toContain('Codex executable');
    expect(wrapper.text()).not.toContain('Enable Claude Code');
    await wrapper.findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
    expect(connectCodex).toHaveBeenCalledOnce();

    await wrapper.setProps({ activeTab: 'claude-code' } as never);

    expect(wrapper.get('.engine-hero__copy strong').text()).toBe('Claude Code');
    expect(wrapper.text()).not.toContain('Enable Claude Code');
    expect(wrapper.text()).not.toContain('Launch ChatGPT');
    expect(wrapper.text()).not.toContain('Codex executable');
    await wrapper.findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
    expect(connectClaude).toHaveBeenCalledOnce();
    await wrapper.setProps({ claudeConnected: true });
    await wrapper.findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click');
    expect(disconnectProvider).toHaveBeenCalledWith('claude');
    await wrapper.setProps({ activeTab: 'codex', codexConnected: true });
    await wrapper.findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click');
    expect(disconnectProvider).toHaveBeenLastCalledWith('codex');
    expect(setProviderEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ['codex', 'codex', 'https://learn.chatgpt.com/docs/codex/cli#getting-started'],
    ['claude-code', 'claude', 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code'],
  ] as const)('offers installation documentation and detection in %s settings', async (activeTab, backend, url) => {
    const refreshProvider = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsView, { props: {
      activeTab, settings: defaultThemeSettings, generalSettings: defaultGeneralSettings, refreshProvider,
      providerConnections: [{ backend, installed: false, connected: false, checking: false }],
    } });
    expect(wrapper.get('.engine-hero').text()).toContain('Not detected');
    expect(wrapper.get('.engine-hero a').attributes('href')).toBe(url);
    expect(wrapper.get('.engine-hero a').text()).toBe('Install');
    expect(getComputedStyle(wrapper.get('.engine-hero a').element).textDecoration).toBe('none');
    const refresh = wrapper.get('.engine-hero button[aria-label="Check again"]');
    expect(refresh.text()).toBe('');
    expect(refresh.find('svg').exists()).toBe(true);
    expect(getComputedStyle(refresh.element).color).toBe(getComputedStyle(wrapper.get('.engine-hero a').element).color);
    expect(wrapper.findAll('button').some(button => button.text() === 'Connect')).toBe(false);
    await wrapper.findAll('button').find(button => button.attributes('aria-label') === 'Check again')!.trigger('click');
    expect(refreshProvider).toHaveBeenCalledExactlyOnceWith(backend);
    await wrapper.setProps({ providerConnections: [{ backend, installed: true, connected: false, checking: false }] });
    expect(wrapper.find('.engine-hero a').exists()).toBe(false);
    expect(wrapper.findAll('button').some(button => button.text() === 'Connect')).toBe(true);
    wrapper.unmount();
  });

  it('renders controlled appearance settings and emits appearance updates', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsView, {
      props: {
        activeTab: 'appearance',
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        updateSettings,
      },
      global: {
        },
    });

    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'dark');
    await wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'github-dark');
    await wrapper.findAllComponents({ name: 'ElInputNumber' })[0].vm.$emit('update:modelValue', 17);

    expect(updateSettings).toHaveBeenCalledWith({ theme: { mode: 'dark', id: 'app-dark' } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { id: 'github-dark' } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { chatFontSize: 17 } });
  });

  it('keeps the general permissions tab reachable', async () => {
    setElectronTestClient({});
    const wrapper = mount(SettingsView, {
      props: {
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        activeTab: 'appearance',
      },
      global: {
        },
    });

    await wrapper.findAll('.el-menu-item').find((item) => item.text() === 'General')?.trigger('click');
    await wrapper.setProps({ activeTab: 'general' } as never);

    expect(wrapper.text()).toContain('Accessibility');
  });

  it('places plugin controls before integrations and forwards plugin management actions', async () => {
    const launchChatGptApp = vi.fn().mockResolvedValue({ status: 'launched' });
    configureAppClient({
      api: { launchChatGptApp } as unknown as AppApi,
      platform: 'desktop',
    });
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsView, {
      props: {
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        activeTab: 'plugins',
        updateSettings,
      },
    });

    expect(wrapper.text()).toContain('Computer Use');
    expect(wrapper.text()).toContain('Chrome');
    const labels = wrapper.findAll('.el-menu-item').map((item) => item.text());
    expect(labels.indexOf('Plugins')).toBeLessThan(labels.indexOf('Integrations'));

    await wrapper.get('[aria-label="Enable Chrome"]').trigger('click');
    await flushPromises();
    expect(launchChatGptApp).toHaveBeenCalledOnce();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('renders the connections tab and forwards SSH actions', async () => {
    const listSshHosts = vi.fn().mockResolvedValue([]);
    const addSshConnection = vi.fn().mockResolvedValue(undefined);
    const checkRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const updateRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const removeRemoteConnection = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(SettingsView, {
      props: {
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        activeTab: 'connections',
        remoteConnections: [{
          id: 'connection-devbox',
          kind: 'ssh',
          name: 'devbox',
          host: 'devbox',
          status: 'saved',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        }],
        teams: [{
          id: 'team-remote',
          name: 'Remote',
          color: '#1B4FB2',
          agentIds: [],
          remoteConnectionId: 'connection-devbox',
        }],
        listSshHosts,
        addSshConnection,
        checkRemoteConnection,
        updateRemoteConnection,
        removeRemoteConnection,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain(`Remote ${product.name} agents`);
    expect(wrapper.text()).toContain('devbox');

    await wrapper.get('[aria-label="devbox actions"]').trigger('click');
    await flushPromises();
    bodyButton('Sync')?.click();
    await flushPromises();
    await wrapper.get('[aria-label="devbox actions"]').trigger('click');
    await flushPromises();
    bodyButton('Delete')?.click();
    await flushPromises();

    expect(checkRemoteConnection).toHaveBeenCalledWith('connection-devbox');
    expect(removeRemoteConnection).toHaveBeenCalledWith('connection-devbox');
  });

  it('omits desktop-only settings when mounted by a web host', () => {
    configureAppClient(undefined);
    const wrapper = mount(SettingsView, {
      props: {
        settings: defaultThemeSettings,
        generalSettings: defaultGeneralSettings,
        activeTab: 'general',
      },
    });

    expect(wrapper.findAll('.el-menu-item').map((item) => item.text())).not.toContain('Screenshots');
    expect(wrapper.text()).not.toContain('Prevent sleep while agents run');
    expect(wrapper.text()).not.toContain(`Keep ${product.name} ready in the background`);
    expect(wrapper.text()).not.toContain('System permissions');
    expect(wrapper.text()).not.toContain('Codex executable');
  });
});

function bodyButton(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')]
    .find((button) => button.textContent?.includes(label));
}

function skillMenuButton(name: string, label: string): HTMLButtonElement | undefined {
  const menu = [...document.body.querySelectorAll('[role="menu"]')].find(menu => menu.getAttribute('aria-label') === `${name} actions`);
  return [...menu?.querySelectorAll('button') ?? []].find(button => button.textContent?.includes(label));
}
