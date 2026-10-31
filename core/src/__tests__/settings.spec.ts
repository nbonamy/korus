import { MAX_DELEGATION_INSTRUCTIONS_LENGTH } from '../delegation-context';
import { describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '../snapshot';
import { defaultAppshotSettings, defaultGeneralSettings, defaultPluginSettings, defaultSourceFolderState, defaultThemeSettings, normalizeAppshotSettings, normalizeGeneralSettings, normalizePluginSettings, normalizeSourceFolderState, normalizeThemeSettings, updateSettingsInSnapshot } from '../settings';

describe('settings contracts', () => {
  it('defaults interactive planning on and preserves an explicit opt-out', () => {
    expect(normalizeGeneralSettings({}).useInteractivePlans).toBe(true);
    expect(defaultGeneralSettings.useInteractivePlans).toBe(true);
    expect(normalizeGeneralSettings({ useInteractivePlans: false }).useInteractivePlans).toBe(false);
    const snapshot = createEmptySnapshot();
    updateSettingsInSnapshot(snapshot, { general: { useInteractivePlans: false } });
    expect(snapshot.general.useInteractivePlans).toBe(false);
  });
  it('defaults delegation to handoff, preserves a saved fork choice and normalizes instructions', () => {
    expect(normalizeGeneralSettings({}).worktreeDelegationStartingContext).toBe('handoff');
    expect(defaultGeneralSettings.worktreeDelegationStartingContext).toBe('handoff');
    expect(normalizeGeneralSettings({ worktreeDelegationStartingContext: 'conversation' }).worktreeDelegationStartingContext).toBe('conversation');
    const snapshot = createEmptySnapshot();
    updateSettingsInSnapshot(snapshot, { general: { worktreeDelegationStartingContext: 'handoff', worktreeDelegationInstructions: '  Keep local.\nTest.  ' } });
    expect(snapshot.general.worktreeDelegationStartingContext).toBe('handoff');
    expect(snapshot.general.worktreeDelegationInstructions).toBe('Keep local.\nTest.');
    expect(normalizeGeneralSettings({ worktreeDelegationInstructions: 'x'.repeat(MAX_DELEGATION_INSTRUCTIONS_LENGTH + 5) }).worktreeDelegationInstructions).toHaveLength(MAX_DELEGATION_INSTRUCTIONS_LENGTH);
    expect(normalizeGeneralSettings({ worktreeDelegationStartingContext: 'unsupported', worktreeDelegationInstructions: 10 }).worktreeDelegationInstructions).toBe('');
    expect(normalizeGeneralSettings({ worktreeDelegationStartingContext: 'unsupported' }).worktreeDelegationStartingContext).toBe('handoff');
  });
  it.each(['codeReviewInstructions', 'missionInstructions'] as const)('normalizes, updates and clears saved %s', field => {
    const snapshot = createEmptySnapshot();
    expect(snapshot.general[field]).toBe('');
    updateSettingsInSnapshot(snapshot, { general: { [field]: '  Check authorization.\nKeep findings actionable.  ' } });
    expect(snapshot.general[field]).toBe('Check authorization.\nKeep findings actionable.');
    expect(normalizeGeneralSettings({ [field]: 42 })[field]).toBe('');
    updateSettingsInSnapshot(snapshot, { general: { [field]: '' } });
    expect(snapshot.general[field]).toBe('');
  });
  it('keeps ordered backlog favorite identities and discards invalid persisted entries', () => {
    expect(normalizeGeneralSettings({}).backlogRepositoryFavorites).toStrictEqual({});
    expect(normalizeGeneralSettings({ backlogRepositoryFavorites: {
      github: ['org/b', 'org/a', 'org/b', '', 42], linear: ['team-id'], unknown: ['org/c'],
    } }).backlogRepositoryFavorites).toStrictEqual({ github: ['org/b', 'org/a'], linear: ['team-id'] });
  });
  it('updates one global Git preference without replacing the other', () => {
    const snapshot = createEmptySnapshot();
    snapshot.general.git = { pull: 'rebase', update: 'merge' };
    updateSettingsInSnapshot(snapshot, { general: { git: { update: 'rebase' } } });
    expect(snapshot.general.git).toStrictEqual({ pull: 'rebase', update: 'rebase' });
  });
  it('defaults follow-ups to queue and retains only supported behavior choices', () => {
    expect(normalizeGeneralSettings({}).followUpBehavior).toBe('queue');
    expect(normalizeGeneralSettings({ followUpBehavior: 'steer' }).followUpBehavior).toBe('steer');
    expect(normalizeGeneralSettings({ followUpBehavior: 'queue' }).followUpBehavior).toBe('queue');
    expect(normalizeGeneralSettings({ followUpBehavior: 'invalid' }).followUpBehavior).toBe('queue');
  });

  it('normalizes general settings', () => {
    expect(normalizeGeneralSettings({
      codexBinaryPath: ' /opt/homebrew/bin/codex ',
      claudeCodeEnabled: true,
      celebrationsEnabled: false,
      spokenAnnouncementsEnabled: true,
      spokenAnnouncementsMuted: true,
      spokenAnnouncementsOnlyForDictatedPrompts: true,
      spokenAnnouncementsOnlyWhenFocused: true,
      spokenAnnouncementScope: 'all',
      spokenAnnouncementVoice: 'bf_emma',
      preventSleepWhenAgentsRun: false,
      agentListCompact: true,
      cockpitAgentViewMode: 'recent',
      appshots: defaultAppshotSettings,
      plugins: defaultPluginSettings,
    })).toStrictEqual({
      git: { pull: 'git-config', update: 'merge' },
      commitMessageInstructions: '',
      pullRequestInstructions: '',
      codeReviewInstructions: '',
      codeReviewDiscussWithOriginalThread: false,
      missionInstructions: '',
      codexBinaryPath: '/opt/homebrew/bin/codex',
      claudeCodeEnabled: true,
      celebrationsEnabled: false,
      followUpBehavior: 'queue',
      spokenAnnouncementsEnabled: true,
      spokenAnnouncementsMuted: true,
      spokenAnnouncementsOnlyForDictatedPrompts: true,
      spokenAnnouncementsOnlyWhenFocused: true,
      spokenAnnouncementScope: 'all',
      spokenAnnouncementVoice: 'bf_emma',
      collapsedRepositoryKeys: [],
      modelFavorites: [],
      backlogRepositoryFavorites: {},
      savedPromptDrafts: [],
      preventSleepWhenAgentsRun: false,
      preventSleepWhenRemoteAccessEnabled: true,
      agentListCompact: true,
      useInteractivePlans: true,
      worktreeInitializationMode: 'automatic',
      worktreeDelegationStartingContext: 'handoff',
      worktreeDelegationInstructions: '',
      autoResumeAfterLimit: true,
      autoResumeOnStartup: true,
      sessionCompressionWarningEnabled: true,
      repositoryIcons: {},
      guestDisplayName: '',
      appshots: defaultAppshotSettings,
      plugins: defaultPluginSettings,
    });

    expect(normalizeGeneralSettings({})).toStrictEqual(defaultGeneralSettings);
    expect(normalizeGeneralSettings({}).spokenAnnouncementsOnlyWhenFocused).toBe(true);
    expect(normalizeGeneralSettings({}).spokenAnnouncementsOnlyForDictatedPrompts).toBe(true);
    expect(normalizeGeneralSettings({ spokenAnnouncementsOnlyForDictatedPrompts: false })
      .spokenAnnouncementsOnlyForDictatedPrompts).toBe(false);
    expect(normalizeGeneralSettings({ spokenAnnouncementsOnlyWhenFocused: false }).spokenAnnouncementsOnlyWhenFocused)
      .toBe(false);
    expect(normalizeGeneralSettings({ spokenAnnouncementVoice: 'not-a-voice' }).spokenAnnouncementVoice)
      .toBe('af_heart');
    expect(normalizeGeneralSettings({ sessionCompressionWarningEnabled: false }).sessionCompressionWarningEnabled)
      .toBe(false);
    expect(normalizeGeneralSettings({ savedPromptDrafts: [
      { id: 'draft-1', agentId: 'agent-1', text: 'Come back later', content: [{ type: 'mention', kind: 'file', id: 'docs/later.md', value: 'docs/later.md', label: 'Come back later' }], createdAt: 1000, unexpected: 'discard' },
      { id: 'draft-2', agentId: 'agent-1', text: '', createdAt: 1001 },
    ] }).savedPromptDrafts).toStrictEqual([
      { id: 'draft-1', agentId: 'agent-1', text: 'Come back later', content: [{ type: 'mention', kind: 'file', id: 'docs/later.md', value: 'docs/later.md', label: 'Come back later' }], createdAt: 1000 },
    ]);
    expect(normalizeGeneralSettings(null)).toStrictEqual(defaultGeneralSettings);
    expect(normalizeAppshotSettings(null)).toStrictEqual(defaultAppshotSettings);
    expect(normalizePluginSettings([])).toStrictEqual(defaultPluginSettings);
    expect(normalizeSourceFolderState(undefined)).toStrictEqual(defaultSourceFolderState);
    expect(normalizeSourceFolderState({ recentRepoNames: 'not-an-array' })).toStrictEqual(defaultSourceFolderState);
  });

  it('normalizes theme settings with bounded font sizes', () => {
    expect(normalizeThemeSettings({
      id: ' one-dark-pro ',
      mode: 'dark',
      uiFontSize: 100,
      chatFontSize: 8,
      codeFontSize: 16.4,
    })).toStrictEqual({
      id: 'one-dark-pro',
      mode: 'dark',
      uiFontSize: 22,
      chatFontSize: 11,
      codeFontSize: 16,
    });

    expect(normalizeThemeSettings({ mode: 'sepia' })).toStrictEqual(defaultThemeSettings);
    expect(normalizeThemeSettings(null)).toStrictEqual(defaultThemeSettings);
    expect(normalizeThemeSettings({ uiFontSize: Number.NaN })).toStrictEqual(defaultThemeSettings);
  });

  it('updates snapshot theme settings without replacing unrelated state', () => {
    const snapshot = createEmptySnapshot();

    updateSettingsInSnapshot(snapshot, {
      theme: {
        id: 'github-dark',
        mode: 'dark',
        chatFontSize: 17,
      },
    });

    expect(snapshot.theme).toStrictEqual({
      ...defaultThemeSettings,
      id: 'github-dark',
      mode: 'dark',
      chatFontSize: 17,
    });
    expect(snapshot.teams).toHaveLength(1);
  });

  it('updates general settings without replacing unrelated state', () => {
    const snapshot = createEmptySnapshot();

    updateSettingsInSnapshot(snapshot, {
      general: {
        preventSleepWhenAgentsRun: false,
      },
    });

    expect(snapshot.general).toStrictEqual({
      git: { pull: 'git-config', update: 'merge' },
      commitMessageInstructions: '',
      pullRequestInstructions: '',
      codeReviewInstructions: '',
      codeReviewDiscussWithOriginalThread: false,
      missionInstructions: '',
      codexBinaryPath: '',
      claudeCodeEnabled: false,
      celebrationsEnabled: true,
      followUpBehavior: 'queue',
      spokenAnnouncementsEnabled: false,
      spokenAnnouncementsMuted: false,
      spokenAnnouncementsOnlyForDictatedPrompts: true,
      spokenAnnouncementsOnlyWhenFocused: true,
      spokenAnnouncementScope: 'selected',
      spokenAnnouncementVoice: 'af_heart',
      collapsedRepositoryKeys: [],
      modelFavorites: [],
      backlogRepositoryFavorites: {},
      savedPromptDrafts: [],
      preventSleepWhenAgentsRun: false,
      preventSleepWhenRemoteAccessEnabled: true,
      agentListCompact: false,
      autoResumeAfterLimit: true,
      autoResumeOnStartup: true,
      sessionCompressionWarningEnabled: true,
      useInteractivePlans: true,
      worktreeInitializationMode: 'automatic',
      worktreeDelegationStartingContext: 'handoff',
      worktreeDelegationInstructions: '',
      repositoryIcons: {},
      guestDisplayName: '',
      appshots: defaultAppshotSettings,
      plugins: defaultPluginSettings,
    });
    expect(snapshot.teams).toHaveLength(1);
  });

  it('normalizes and updates repository icons by canonical repository root', () => {
    expect(normalizeGeneralSettings({
      repositoryIcons: {
        ' /src/agent-workspace ': ' 🦞 ',
        '': '🚫',
        '/src/invalid': 12,
      },
    }).repositoryIcons).toStrictEqual({ '/src/agent-workspace': '🦞' });

    const snapshot = createEmptySnapshot();
    updateSettingsInSnapshot(snapshot, {
      general: { repositoryIcons: { '/src/agent-workspace': '🦞' } },
    });
    expect(snapshot.general.repositoryIcons).toStrictEqual({ '/src/agent-workspace': '🦞' });
  });

  it('migrates credential-bearing repository icon keys to canonical remote identities', () => {
    expect(normalizeGeneralSettings({
      repositoryIcons: {
        'https://oauth2:secret@github.com/openai/agent-workspace.git': '🦞',
      },
    }).repositoryIcons).toStrictEqual({
      'remote:github.com/openai/agent-workspace': '🦞',
    });
  });

  it('normalizes persisted collapsed repository keys', () => {
    expect(normalizeGeneralSettings({
      collapsedRepositoryKeys: [' remote:github.com/openai/codex ', '', 'remote:github.com/openai/codex'],
    }).collapsedRepositoryKeys).toStrictEqual(['remote:github.com/openai/codex']);
  });

  it('normalizes and deduplicates model favorites', () => {
    expect(normalizeGeneralSettings({
      modelFavorites: [
        { backend: 'codex', modelId: ' terra ', reasoningEffort: ' medium ', serviceTier: ' priority ' },
        { backend: 'codex', modelId: 'terra', reasoningEffort: 'medium', serviceTier: 'priority' },
        { backend: 'codex', modelId: 'sol', reasoningEffort: 'high', serviceTier: 'default' },
        { backend: 'claude', modelId: 'sonnet', reasoningEffort: null, serviceTier: null },
        { backend: 'missing', modelId: 'ignored', reasoningEffort: null, serviceTier: null },
        { backend: 'codex', modelId: '', reasoningEffort: null, serviceTier: null },
      ],
    }).modelFavorites).toStrictEqual([
      { backend: 'codex', modelId: 'terra', reasoningEffort: 'medium', serviceTier: 'priority' },
      { backend: 'codex', modelId: 'sol', reasoningEffort: 'high', serviceTier: null },
      { backend: 'claude', modelId: 'sonnet', reasoningEffort: null, serviceTier: null },
    ]);
  });

  it('normalizes worktree initialization policy', () => {
    expect(normalizeGeneralSettings({ worktreeInitializationMode: 'repository' }).worktreeInitializationMode).toBe('repository');
    expect(normalizeGeneralSettings({ worktreeInitializationMode: 'off' }).worktreeInitializationMode).toBe('off');
    expect(normalizeGeneralSettings({ worktreeInitializationMode: 'invalid' }).worktreeInitializationMode).toBe('automatic');
  });

  it('updates source folder settings without replacing unrelated state', () => {
    const snapshot = createEmptySnapshot();
    snapshot.sourceFolder.recentRepoNames = ['skwad'];

    updateSettingsInSnapshot(snapshot, {
      sourceFolder: {
        path: ' ~/src ',
      },
    });

    expect(snapshot.sourceFolder).toStrictEqual({
      path: '~/src',
      initialized: true,
      recentRepoNames: ['skwad'],
    });
    expect(snapshot.teams).toHaveLength(1);

    updateSettingsInSnapshot(snapshot, {
      sourceFolder: {
        path: '',
      },
    });

    expect(snapshot.sourceFolder).toStrictEqual({
      path: '',
      initialized: true,
      recentRepoNames: [],
    });

    updateSettingsInSnapshot(snapshot, {
      sourceFolder: {
        recentRepoNames: [' one ', '', 'two', 'three', 'four', 'five', 'six', 'one'],
      },
    });

    expect(snapshot.sourceFolder.recentRepoNames).toStrictEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('persists plugin access settings separately from the general controls', () => {
    const snapshot = createEmptySnapshot();

    updateSettingsInSnapshot(snapshot, {
      general: { plugins: { computerUseEnabled: true, chromeEnabled: true } },
    });

    expect(snapshot.general.plugins).toStrictEqual({
      computerUseEnabled: true,
      chromeEnabled: true,
    });
  });

  it('updates GitHub provider settings without replacing connection state', () => {
    const snapshot = createEmptySnapshot();
    snapshot.workBacklog.connections[0] = {
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    };

    updateSettingsInSnapshot(snapshot, {
      workProviders: {
        github: {
          oauthClientId: ' client-id ',
        },
      },
    });

    expect(snapshot.workBacklog.providerSettings).toStrictEqual({
      github: {
        oauthClientId: 'client-id',
      },
    });
    expect(snapshot.workBacklog.connections[0]).toStrictEqual({
      provider: 'github',
      status: 'connected',
      accountLabel: 'nbonamy',
    });

    updateSettingsInSnapshot(snapshot, {
      workProviders: {
        github: {
          oauthClientId: '',
        },
      },
    });

    expect(snapshot.workBacklog.providerSettings).toStrictEqual({});

    updateSettingsInSnapshot(snapshot, {
      workProviders: { github: { oauthClientId: null as never } },
    });
    expect(snapshot.workBacklog.providerSettings).toStrictEqual({});
  });

  it('keeps only well-formed provider model defaults when loading general settings', () => {
    expect(normalizeGeneralSettings({
      providerModelDefaults: {
        codex: { model: ' gpt-x ', reasoningEffort: 'high', serviceTier: '' },
        claude: { model: '', reasoningEffort: 'low' },
        antigravity: { model: 'gemini-low', reasoningEffort: 'high', serviceTier: 'fast' },
        other: { model: 'ignored' },
      },
    }).providerModelDefaults).toStrictEqual({
      codex: {backend: 'codex',  model: 'gpt-x', reasoningEffort: 'high', serviceTier: null },
      antigravity: {backend: 'antigravity',  model: 'gemini-low', reasoningEffort: null, serviceTier: null },
    });
  });

  it('loads supported approval defaults without accepting malformed or unknown modes', () => {
    expect(normalizeGeneralSettings({ providerApprovalDefaults: { codex: 'ask-for-approval', claude: 'acceptEdits', other: 'ignored' } }).providerApprovalDefaults)
      .toStrictEqual({ codex: 'ask-for-approval', claude: 'acceptEdits' });
    expect(normalizeGeneralSettings({ providerApprovalDefaults: { codex: 'invalid', claude: 'invalid' } }).providerApprovalDefaults).toStrictEqual({});
  });

  it('retains review defaults across settings normalization without retaining invalid automatic authorization', () => {
    const codeReviewDefaults = { backend: 'claude', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 }, providers: { codex: { model: 'codex-model', reasoningEffort: 'high' }, claude: { model: 'sonnet' } } };
    const normalized = normalizeGeneralSettings({ codeReviewDefaults });
    expect(normalizeGeneralSettings(JSON.parse(JSON.stringify(normalized))).codeReviewDefaults).toStrictEqual({ ...codeReviewDefaults, providers: { codex: { backend: 'codex', model: 'codex-model', reasoningEffort: 'high', serviceTier: null }, claude: { backend: 'claude', model: 'sonnet', reasoningEffort: null, serviceTier: null } } });
    expect(normalizeGeneralSettings({ codeReviewDefaults: { ...codeReviewDefaults, automation: { enabled: 'yes', maxPriority: 'p2', maxRounds: 3 } } }).codeReviewDefaults).toBeUndefined();
  });
});
