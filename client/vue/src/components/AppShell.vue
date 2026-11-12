<template>
  <main
    class="app-shell"
    :class="{ 'app-shell--auth-gated': showOnboardingGate, 'app-shell--no-rail': hideTeamRail, 'app-shell--chromeless': chromeless, 'app-shell--sidebar-collapsed': agentSidebarCollapsed }"
    @contextmenu.capture="conversationFileActions.capture"
  >
    <AppContextMenu
      v-if="conversationFileActions.menu.value"
      :x="conversationFileActions.menu.value.x"
      :y="conversationFileActions.menu.value.y"
      :items="conversationFileActions.items.value"
      :ariaLabel="t('chat.fileActions.title')"
      @close="conversationFileActions.close"
      @select="conversationFileActions.select"
    />
    <FirstRunOnboardingGate
      v-if="!currentAgent?.sharedConversation"
      :provider-setup="displayProviderSetup"
      :allow-setup-reset="settingsVisible"
      :customized-setup="customizedSetup"
      :setup-busy="setupBusy"
      :updating-provider="updatingProvider"
      :setup-error="setupError"
      @customize="customizeProvider"
      @refresh-provider="refreshProvider"
      @install-provider="installProvider"
      @close-setup="customizingProvider = null"
      @save-setup="saveProviderSetup"
      v-model:claude-dialog-visible="claudeDialogVisible"
      :claude-authentication="claudeAuthentication"
      :claude-connected="!debugMissingEngines && claudeConnected"
      :claude-loading="!debugMissingEngines && claudeLoading"
      :claude-error="debugMissingEngines ? null : claudeError"
      :codex-connected="!debugMissingEngines && codexConnected"
      :continuing="continuing"
      @connect-claude="connectClaude"
      :cursor-connected="!debugMissingEngines && cursorConnected"
      :cursor-loading="!debugMissingEngines && cursorLoading"
      :cursor-pending="!debugMissingEngines && cursorPending"
      :cursor-error="debugMissingEngines ? null : cursorConnectionError"
      @connect-cursor="connectCursor"
      @cancel-cursor="cancelCursorLogin"
      :antigravity-connected="!debugMissingEngines && antigravityConnected"
      :antigravity-loading="!debugMissingEngines && antigravityLoading"
      :antigravity-pending="!debugMissingEngines && antigravityPending"
      :antigravity-error="debugMissingEngines ? null : antigravityError"
      @connect-antigravity="connectAntigravity"
      @cancel-antigravity="cancelAntigravityLogin"
      @refresh-claude="refreshClaude"
      @continue="continueWithProviders"
      :authentication="debugMissingEngines ? null : authentication"
      :authentication-cancelling="authenticationCancelling"
      :authentication-error="debugMissingEngines ? null : authenticationError"
      :authentication-loading="!debugMissingEngines && authenticationLoading"
      :repositories-onboarding-visible="!debugMissingEngines && repositoriesOnboardingVisible"
      :initial-authentication-loading="!debugMissingEngines && initialAuthenticationLoading"
      :onboarding-complete-visible="!debugMissingEngines && onboardingCompleteVisible"
      :show-login-landing="showLoginLanding"
      :snapshot="snapshot"
      :work-provider-authorizations="workProviderAuthorizations ?? (workProviderAuthorization ? { [workProviderAuthorization.provider]: workProviderAuthorization } : {})"
      :work-provider-authorization-errors="workProviderAuthorizationErrors"
      :connect-repository-provider="connectWorkProvider"
      :disconnect-repository-provider="disconnectWorkProvider"
      :open-repository-authorization="openWorkProviderAuthorization"
      @cancel="cancelChatGptLogin"
      @complete="firstRunOnboarding.completeRepositories"
      @finish="finishFirstRunOnboarding"
      @login="startChatGptLogin"
    />
    <div
      v-if="!chromeless"
      class="app-shell__nav"
      :class="{ 'app-shell__nav--compact': compactViewport, 'app-shell__nav--open': compactNavOpen }"
    >
    <AppShellNavigation
      ref="navigation"
      :active-mission-id="activeHost === 'mission' ? selectedMissionId : null"
      :mission-creation-error="missionCreationError"
      :mission-creation-pending="missionCreationPending"
      :phone-scope="compactViewport"
      :hide-team-rail="hideTeamRail"
      :feature-agent-ids="featureWindow ? featureAgents : undefined"
      @create-mission="createNewMission"
      @delete-mission="deleteMissionFromSidebar"
      @open-mission-window="openMissionWindow"
      @create-agent-in-mission-worktree="createAgentInMissionWorktree"
      @open-feature="openFeatureAgents"
      @rename-feature="showFeatureDialog('rename', $event)"
      @reorder-feature="reorderFeature"
      @delete-feature="showFeatureDialog('delete', $event)"
      @delete-repository="repositoryDeletionAgentId = $event"
      @select-mission="selectMission"
      :active-team="activeTeam"
      :active-team-agents="activeTeamAgents"
      :active-team-name="activeTeamName"
      :agent-list-compact="agentListCompact"
      :agent-sidebar-width="agentSidebarWidth"
      :authentication="authentication"
      :automations-visible="automationsVisible"
      :backlog-visible="backlogVisible"
      :cockpit-visible="cockpitVisible"
      :current-agent="currentAgent"
      :forkable-agent-ids="forkableAgentIds"
      :summary-replacement-agent-ids="summaryReplacementAgentIds"
      :list-repository-session-branches="listRepositorySessionBranches"
      :open-in-applications="openInApplications"
      :quick-agent-shortcuts-visible="quickAgentShortcutsVisible"
      :settings-visible="settingsVisible"
      :show-agent-sidebar="showAgentSidebar"
      :snapshot="snapshot"
      :unread-agent-ids="unreadAgentIds"
      :unread-team-ids="unreadTeamIds"
      :working-team-ids="workingTeamIds"
      @close-team="$emit('close-team', $event)"
      @close-agent="$emit('close-agent', $event)"
      @compress-session="$emit('compress-session', $event)"
      @compact-session="compactAgentSession($event)"
      @cleanup-pull-request="$emit('cleanup-pull-request', $event)"
      @collapse-sidebar="collapseSidebar"
      @create-agent-from-repository="openRepositorySessionSource"
      @create-agent-on-branch="createRepositorySessionOnBranch"
      @create-agent-worktree-in-repository="openRepositorySessionWorktree"
      @create-feature-agent="openFeatureAgentDialog"
      @create-feature-worktree="openFeatureWorktreeDialog"
      @open-on-remote="openOnRemote"
      @create-quick-chat="createQuickChat"
      @duplicate-agent="$emit('duplicate-agent', $event)"
      @open-agent-window="openAgentWindow"
      @open-team-window="openTeamWindow"
      @open-feature-window="openFeatureWindow"
      @edit-agent="openEditAgent"
      @edit-team="openEditTeam"
      @fork-agent="$emit('fork-agent', $event)"
      @share-agent="openShare"
      @handoff-agent="openHandoff"
      @move-agent-to-team="$emit('move-agent-to-team', $event)"
      @new-team="openNewTeam"
      @open-automations="openAutomations"
      @open-backlog="openBacklog"
      @open-cockpit="openCockpit"
      @open-in="openAgentIn($event.agentId, $event.application)"
      @open-settings="openSettings"
      @open-whats-new="openWhatsNew"
      @quit="quit"
      @reorder-agents="$emit('reorder-agents', $event)"
      @reorder-repositories="$emit('reorder-repositories', $event)"
      @reorder-teams="$emit('reorder-teams', $event)"
      @resize-sidebar="setAgentSidebarWidth"
      @start-sidebar-resize="startAgentSidebarResize"
      @restart-agent="$emit('restart-agent', $event)"
      @resume-session="openResumeSession"
      @select-agent="selectAgentFromShell"
      @select-team="selectTeamFromRail"
      @start-work="handleStartWorkAction"
      @toggle-speech-mute="toggleSpokenAnnouncementsMuted"
      @update-collapsed-repositories="updateCollapsedRepositories"
      @update-repository-icon="updateRepositoryIcon"
    />
    </div>
    <div
      v-if="!chromeless && compactViewport && compactNavOpen"
      class="app-shell__nav-backdrop"
      aria-hidden="true"
      @click="compactNavOpen = false"
    />
    <section class="app-shell__content">
      <BackendConnectionBanner :connection-state="connectionState" />
      <header v-if="compactViewport && !isAgentWorkspaceVisible && activeHost !== 'mission'" class="app-shell__compact-bar">
        <SidebarExpandButton :label="t('surface.agentHeader.showAgentSidebar')" @click="expandSidebar" />
      </header>
      <SettingsView
        v-if="settingsVisible"
        :codex-connected="!debugMissingEngines && codexConnected"
        :provider-connections="displayProviderConnections"
        :provider-runtimes="snapshot.providerRuntimes"
        :refresh-provider="refreshProvider"
        :install-provider="installProvider"
        :provider-setup-error="setupError"
        :updating-provider="updatingProvider"
        :customize-provider="customizeProvider"
        :claude-connected="!debugMissingEngines && claudeConnected"
        :connection-activity="debugMissingEngines ? {} : connectionActivity"
        :set-provider-enabled="setEngineEnabled"
        :codex-login-pending="!debugMissingEngines && authentication?.login.status === 'pending'"
        :connect-codex="startChatGptLogin"
        :connect-claude="connectClaude"
        :connect-cursor="connectCursor"
        :cancel-cursor-login="cancelCursorLogin"
        :cursor-login-pending="!debugMissingEngines && cursorPending"
        :connect-antigravity="connectAntigravity"
        :cancel-antigravity-login="cancelAntigravityLogin"
        :antigravity-login-pending="!debugMissingEngines && antigravityPending"
        :disconnect-provider="disconnectProvider"
        :cancel-codex-login="cancelChatGptLogin"
        :active-tab="settingsActiveTab"
        :general-settings="snapshot.general"
        :provider-setup="displayProviderSetup"
        :settings="snapshot.theme"
        :source-folder="snapshot.sourceFolder"
        :work-backlog-connections="snapshot.workBacklog.connections"
        :work-backlog-error="workBacklogError"
        :work-backlog-status="workBacklogStatus"
        :work-provider-settings="snapshot.workBacklog.providerSettings"
        :work-provider-authorization="workProviderAuthorization"
        :work-provider-authorizations="workProviderAuthorizations"
        :remote-connections="snapshot.remoteConnections.connections"
        :agents="snapshot.agents"
        :list-source-folders="listSourceFolders"
        :list-ssh-hosts="listSshHosts"
        :add-ssh-connection="addSshConnection"
        :check-remote-connection="checkRemoteConnection"
        :update-remote-connection="updateRemoteConnection"
        :remove-remote-connection="removeRemoteConnection"
        :companion-control="companionControl"
        :get-remote-control-status="getRemoteControlStatus"
        :enable-remote-control="enableRemoteControl"
        :disable-remote-control="disableRemoteControl"
        :start-device-pairing="startDevicePairing"
        :check-device-pairing="checkDevicePairing"
        :list-paired-devices="listPairedDevices"
        :revoke-paired-device="revokePairedDevice"
        :daemon-status="daemonStatus"
        :daemon-status-error="daemonStatusError"
        :choose-source-folder="chooseSourceFolder"
        :connect-work-provider="connectWorkProvider"
        :open-work-provider-authorization="openWorkProviderAuthorization"
        :complete-work-provider-connection="pollWorkProviderAuthorization"
        :disconnect-work-provider="disconnectWorkProvider"
        :update-settings="updateSettings"
        :get-plugin-status="getPluginStatus"
        :set-daemon-enabled="setDaemonEnabled"
        :restart-app="restartApp"
        @select-tab="settingsActiveTab = $event"
      />
      <AutomationsView
        v-else-if="automationsVisible"
        :clear-automation-history="clearAutomationHistory"
        :create-automation="createAutomation"
        :delete-automation-execution="deleteAutomationExecution"
        :delete-automation="deleteAutomation"
        :get-automation-snapshot="getAutomationSnapshot"
        :automations="snapshot.automations"
        :agents="snapshot.agents"
        :missions="snapshot.missions"
        :list-models="listHandoffModels"
        :read-conversation-messages="readConversationMessages"
        :remote-connections="snapshot.remoteConnections.connections"
        :run-automation="runAutomation"
        :teams="snapshot.teams"
        :update-automation="updateAutomation"
      />
      <BacklogView
        v-else-if="backlogVisible"
        :agents="snapshot.agents"
        :remote-connections="snapshot.remoteConnections.connections"
        :default-team-id="snapshot.activeTeamId"
        :repository-icons="snapshot.general.repositoryIcons"
        :start-work-items-action="startCockpitWorkItems"
        :list-source-repositories="listSourceRepositories"
        :teams="snapshot.teams"
        :work-backlog="cockpitWorkBacklog"
        :repository-favorites="snapshot.general.backlogRepositoryFavorites[cockpitBacklogState.provider.value] ?? []"
        :save-repository-favorites="updateBacklogRepositoryFavorites"
        @assign-work-item-to-new-agent="openNewAgentForWorkItem"
        @assign-work-item="assignExistingAgentWorkItem"
        @refresh-work-items="refreshWorkItems"
        @change-work-items-page="changeGlobalWorkItemsPage"
        @select-global-scope="selectGlobalBacklogScope"
        @select-work-tag="selectWorkTagForCockpit"
        @select-work-assignee="selectWorkAssigneeForCockpit"
        @select-work-repository="selectWorkRepositoryForCockpit"
        :work-provider="cockpitBacklogState.provider.value"
        :work-providers="cockpitBacklogState.providers.value"
        @select-work-provider="cockpitBacklogState.selectProvider"
        @select-agent="selectAgentFromBacklog"
      />
      <AgentWorkspace
        v-else
        :guest-view="guestState?.view" :guest-busy="guestBusy" :guest-control="guestControl"
        ref="agentWorkspace"
        :show-header="activeHost !== 'mission'"
        :add-visualization-annotation="addFocusedVisualizationAnnotation"
        :add-code-annotation="addFocusedCodeAnnotation"
        :agent-files="agentFiles"
        :agent-sidebar-collapsed="agentSidebarCollapsed || compactViewport"
        :close-right-workspace-tab="closeRightWorkspaceTab"
        :save-document-as="saveDocumentAs"
        :commit-agent-git-changes="props.commitAgentGitChanges"
        :update-plan-review="updatePlanReview"
        :conversation-plan="conversationPlan"
        :create-agent-git-pull-request="props.createAgentGitPullRequest"
        :current-agent="currentAgent"
        :empty-split-pane="activeHost !== 'mission' && !hasFocusedConversation"
        :split-headers="activeHost !== 'mission' && splitLayout !== 'single'"
        :latest-turn-id-for-agent="latestTurnIdForAgent"
        :current-agent-git-status="currentAgentGitStatus"
        :current-provider-runtime="currentProviderRuntime"
        :forward-prompt="forwardPrompt"
        :generate-agent-git-message="props.generateAgentGitMessage"
        :get-agent-git-workflow="props.getAgentGitWorkflow"
        :handle-start-work-action="handleStartWorkAction"
        :is-agent-empty="activeHost !== 'mission' && !cockpitVisible && isAgentEmpty"
        :is-conversation-loading="isConversationLoading"
        :is-loading="isLoading"
        :is-modal-dialog-visible="isModalDialogVisible"
        :is-right-workspace-visible="isPresentedWorkspaceVisible"
        :has-visible-messages="conversationMessages.length > 0"
        :has-running-plan-tool="conversationHasRunningPlanTool"
        :latest-conversation-turn-id="conversationLatestTurnId"
        :merge-agent-git-branch="props.mergeAgentGitBranch"
        :update-agent-git-branch-from-base="props.updateAgentGitBranchFromBase"
        :pull-agent-git-branch="props.pullAgentGitBranch"
        :revert-agent-git-changes="props.revertAgentGitChanges"
        :update-agent="props.updateAgent"
        :open-agent-git-diff-preview="openAgentGitDiffPreview"
        :open-agent-in="openAgentIn"
        :open-conversation-link="openConversationLink"
        :open-file-preview-for-agent="openFilePreviewForAgent"
        :open-in-applications="openInApplications"
        :open-right-workspace-tab="openRightWorkspaceTab"
        :push-agent-git-branch="props.pushAgentGitBranch"
        :right-workspace-for="rightWorkspaceFor"
        :preview-dialog="activeHost === 'mission'"
        :close-preview="closeWorkspacePreview"
        :right-workspaces="rightWorkspaces"
        :right-workspace-visible="activeHost === 'mission' ? missionWorkspaceVisible : rightWorkspaceVisible"
        :read-conversation-messages="readConversationMessages"
        :select-agent-from-shell="selectAgentFromShell"
        :select-right-workspace-tab="selectRightWorkspaceTab"
        :snapshot="snapshot"
        :start-repository-work="startRepositoryWork"
        :start-right-workspace-resize="startRightWorkspaceResize"
        :right-workspace-resizing="rightWorkspaceResizing"
        :toggle-file-explorer="toggleFileExplorer"
        :toggle-right-workspace="toggleRightWorkspace"
        :update-status="updateStatus"
        :start-code-review="startCodeReviewFromShell"
        :decide-code-review-finding="props.decideCodeReviewFinding"
        :submit-code-review-round="props.submitCodeReviewRound"
        :finish-code-review="props.finishCodeReview"
        :commit-code-review="props.commitCodeReview"
        :discard-code-review="props.discardCodeReview"
        :review-code-again="props.reviewCodeAgain"
        :start-visualize="startVisualizeForAgent"
        :generate-visualization-suggestion="props.generateVisualizationSuggestion"
        :select-visualization="props.selectVisualization"
        :delete-visualization="props.deleteVisualization"
        :read-visualization-asset="props.readVisualizationAsset"
        @share-agent="openShare"
        @close-agent="$emit('close-agent', $event)"
        @clarify-code-review-finding="clarifyCodeReviewFinding"
        @expand-sidebar="expandSidebar"
        @install-update="emit('install-update')"
        @remove-work-item-assignment="$emit('remove-work-item-assignment', $event)"
        @send-prompt="emit('sendPrompt', $event)"
        @open-browser-settings="openSettings('browser')"
        @update:plan-mode="emit('update:planMode', $event)"
      >
        <template v-if="activeHost !== 'mission' && !compactViewport && props.agentConversationFor && props.agentConversationActions" #layout-control>
          <SplitLayoutControl :model-value="split.layout.value" @update:model-value="split.setLayout" />
        </template>
        <template v-if="activeHost === 'mission' && selectedMission" #conversation>
          <MissionWorkspace :repository-icons="snapshot.general.repositoryIcons" v-model:viewed-stage="missionViewedStage" :workspace-preview-open="missionWorkspaceVisible" :workspace-toggle-available="Boolean(currentAgent && !currentAgent.sharedConversation)" :key="selectedMission.id" :agents="snapshot.agents" :unread-agent-ids="unreadAgentIds" :sidebar-collapsed="agentSidebarCollapsed || compactViewport" @expand-sidebar="expandSidebar" @toggle-workspace="toggleRightWorkspace" :mission="selectedMission" :implementation-start-progress="missionImplementationStartProgress" :read-mission-artifact="readMissionArtifact" :execute-mission="executeMission" :send-mission-prompt="forwardPrompt" :open-in-available="missionOpenInAvailable" :open-in-applications="openInApplications" @chat-about-review-finding="prepareMissionReviewDiscussion" @open-conversation="emit('select-agent', $event)" @open-worktree="openMissionWorktree">
            <template #code-review="{ agentId, reviewSummary, chatAboutFinding }">
              <MissionCodeReview v-if="snapshot.agents.find(agent => agent.id === agentId) && props.getAgentGitDiff" :agent="snapshot.agents.find(agent => agent.id === agentId)!" :agents="snapshot.agents" :git-statuses="snapshot.agentGitStatuses" :get-diff="props.getAgentGitDiff" :mission="selectedMission" :review-summary="reviewSummary" :execute-mission="executeMission" :open-in-available="missionOpenInAvailable" :open-in-applications="openInApplications" @chat-about-finding="chatAboutFinding" @open-worktree="openMissionWorktree" />
            </template>
            <template #ship="{ openConversation }">
              <MissionShipBoard
                :agents="snapshot.agents"
                :teams="snapshot.teams"
                :mission="selectedMission"
                :execute-mission="executeMission"
                :git-statuses="snapshot.agentGitStatuses"
                :get-workflow="props.getAgentGitWorkflow"
                :generate-message="props.generateAgentGitMessage"
                :commit-changes="props.commitAgentGitChanges"
                :push-branch="props.pushAgentGitBranch"
                :create-pull-request="props.createAgentGitPullRequest"
                :merge-branch="props.mergeAgentGitBranch"
                :update-from-base="props.updateAgentGitBranchFromBase"
                :open-in-available="missionOpenInAvailable"
                :open-in-applications="openInApplications"
                @open-conversation="openConversation"
                @open-worktree="openMissionWorktree"
              />
            </template>
            <template #conversation="{ agentId }">
              <AgentConversationPanel v-if="currentAgent?.id === agentId && conversationViewFor(agentId)" :key="agentId" :ref="instance => setConversationPanel(agentId, instance)"
                :view="conversationViewFor(agentId)!" :actions="conversationActions" :agents="snapshot.agents" :focused="true"
                :preview-message="debugUserQuestions?.agentId === agentId ? debugUserQuestions.message : undefined"
                :preview-approval="debugApproval?.agentId === agentId ? debugApproval.request : undefined"
                :mention-groups="agentMentionGroups" :model-menu-items="conversationModelFavoriteMenuItems(agentId)"
                :select-model-menu-item="item => selectConversationModelMenuItem(agentId, item)"
                :saved-prompt-drafts="snapshot.general.savedPromptDrafts" :save-prompt-draft="savePromptDraft" :remove-prompt-draft="removePromptDraft"
                :follow-up-behavior="snapshot.general.followUpBehavior"
                :empty-headline="selectedMission.stage === 'requirements' ? t('missions.whatDoYouWantToBuild') : undefined"
                :empty-subhead="selectedMission.stage === 'requirements' ? '' : undefined"
                :placeholder="selectedMission.stage === 'requirements' && conversationMessages.length === 0 ? t('missions.describeWhatYouWantToBuild') : undefined"
                :open-link="link => openConversationLink(agentId, link)"
                :open-image="(image, context) => agentWorkspace?.openConversationImage(image, context, agentId) ?? false"
                :open-visualization="visualization => agentWorkspace?.openConversationVisualization(visualization, agentId)"
                @annotation-dialog="conversationAnnotationVisible = $event"
                @open-review="openRightWorkspaceTab('codeReview', $event)" @composer-command="runConversationMenuCommand">
                <template #composer-drawers>
                  <MissionDocumentRequest v-if="missionDocuments.pending.value" :request="missionDocuments.pending.value" @open="missionDocuments.confirm" @dismiss="missionDocuments.dismiss" />
                </template>
                <template v-if="selectedMission.stage === 'requirements' && conversationMessages.length === 0" #empty-actions>
                  <AppMenu class="app-menu--embedded" :ariaLabel="t('missions.chooseIssue')" :items="missionSourceMenuItems" @select="openMissionIssuePicker" />
                </template>
              </AgentConversationPanel>
            </template>
          </MissionWorkspace>
        </template>
        <template v-else-if="cockpitVisible && !currentAgent" #conversation>
          <p class="app-shell__empty-cockpit">{{ t('sidebar.noConversations') }}</p>
        </template>
        <template v-else #conversation="{ plan, planVisible, closePlan, headerBindingsFor }">
          <AgentSplitGrid :layout="splitLayout" :panes="conversationPanes" :focused-pane-id="split.focusedPaneId.value" :ratios="split.ratios.value" @resize="split.resize" @focus="focusSplitPane">
            <template #header="{ agentId, topRight, topLeft }">
              <AgentHeader v-if="splitLayout !== 'single'" v-bind="headerBindingsFor(agentId, topRight, topLeft)" />
            </template>
            <template #default="{ agentId, focused }">
              <SharedConversationPane v-if="guestState?.view && guestState.view.id === snapshot.agents.find(agent => agent.id === agentId)?.sharedConversation?.joinId && guestControl" :view="guestState.view" :follow-up-behavior="snapshot.general.followUpBehavior" :busy="guestBusy ?? false" :control="guestControl" />
              <button v-else-if="snapshot.agents.find(agent => agent.id === agentId)?.sharedConversation" class="app-button" @click="selectAgentFromShell(agentId)">{{ t('guest.open') }}</button>
              <AgentConversationPanel v-else-if="conversationViewFor(agentId)" :key="agentId" :ref="instance => setConversationPanel(agentId, instance)"
                :view="conversationViewFor(agentId)!" :actions="conversationActions" :agents="snapshot.agents" :focused="focused"
                :preview-message="debugUserQuestions?.agentId === agentId ? debugUserQuestions.message : undefined"
                :preview-approval="debugApproval?.agentId === agentId ? debugApproval.request : undefined"
                :mention-groups="agentMentionGroups" :model-menu-items="conversationModelFavoriteMenuItems(agentId)"
                :select-model-menu-item="item => selectConversationModelMenuItem(agentId, item)"
                :plan="focused ? plan : null" :plan-visible="planVisible" @close-plan="closePlan"
                :saved-prompt-drafts="snapshot.general.savedPromptDrafts" :save-prompt-draft="savePromptDraft" :remove-prompt-draft="removePromptDraft"
                :follow-up-behavior="snapshot.general.followUpBehavior"
                :review-finding="pendingReviewClarification?.agentId === agentId ? pendingReviewClarification.finding : null"
                :open-link="link => openConversationLink(agentId, link)"
                :open-image="(image, context) => agentWorkspace?.openConversationImage(image, context, agentId) ?? false"
                :open-visualization="visualization => agentWorkspace?.openConversationVisualization(visualization, agentId)"
                @annotation-dialog="conversationAnnotationVisible = $event"
                @open-review="openRightWorkspaceTab('codeReview', $event)"
                @composer-command="runConversationMenuCommand"
                @remove-review-finding="pendingReviewClarification = null" />
            </template>
          </AgentSplitGrid>
        </template>
      </AgentWorkspace>
    </section>
    <RepositorySessionSourceDialog
      v-model:provider="repositorySession.provider.value"
      :visible="repositorySessionSourceVisible"
      :repository-name="repositorySessionSource?.repositoryName ?? ''"
      :branches="repositorySessionSourceBranches"
      :work-items="repositorySessionSourceWorkItems"
      :selected-repository-id="repositorySession.workSourceId.value"
      :loading="repositorySessionSourceLoading"
      :error="repositorySessionSourceError"
      :model-agent-id="repositorySession.modelAgentId.value"
      :sessions="repositorySessionAssignmentSessions"
      :hosts="repositorySession.hosts.value"
      :host-id="repositorySession.hostId.value"
      :host-checkout="repositorySession.hostCheckout.value"
      :host-busy="repositorySession.hostBusy.value"
      @change-host="repositorySession.changeHost"
      @close="closeRepositorySessionSource"
      @select-branch="openNewAgentForSourceBranch"
      @custom-work-item="customizeRepositorySessionWork"
      @start-work-item="startRepositorySessionWork"
    />
    <RepositorySessionSourceDialog
      :visible="missionIssuePickerVisible"
      purpose="missionIssue"
      :source-filter="acceptMissionSource"
      repository-name=""
      :loading="missionIssueLoading"
      :error="missionIssueError"
      @close="closeMissionIssuePicker"
      @select-work-item="chooseMissionIssue"
    />
    <NewSourceWorktreeDialog
      :remote-connection-id="repositorySession.worktreeRemoteConnectionId.value"
      v-model:provider="repositorySession.provider.value"
      :allow-destination-override="false"
      :branches="repositorySessionWorktreeBranches"
      :branches-loading="repositorySessionWorktreeBranchesLoading"
      :visible="repositorySessionWorktreeSource !== null"
      :repo="repositorySessionWorktreeRepository"
      :choose-destination="chooseSourceWorktreeDestination"
      :create-worktree="createRepositorySessionWorktree"
      :suggest-destination="suggestRepositorySessionWorktreePath"
      @close="closeRepositorySessionWorktree"
      @created="createRepositorySessionFromWorktree"
    />
    <RepositoryAcquireDialog
      :visible="repositoryAcquireVisible"
      :mode="repositoryAcquireMode"
      :connection="repositoryAcquisition.connection.value"
      :authorization="repositoryAcquireMode !== 'url' ? workProviderAuthorizations?.[repositoryAcquireMode] ?? (workProviderAuthorization?.provider === repositoryAcquireMode ? workProviderAuthorization : null) : null"
      :repositories="repositoryAcquireRepositories"
      :local-repository-identities="repositoryAcquireSourceRepositories.flatMap((repository) => repository.remoteIdentity ? [repository.remoteIdentity] : [])"
      :loading="repositoryAcquireCatalogLoading"
      :busy="repositoryAcquireBusy"
      :progress="repositoryAcquisition.cloneProgress.value"
      :error="repositoryAcquireDisplayError"
      @close="closeRepositoryAcquire"
      @background="closeRepositoryAcquire"
      @clone-url="cloneRepositoryAndOpen"
      @connect="connectGitHub"
      @open-authorization="openGitHubAuthorization"
      @select-repository="selectWorkRepository"
    />
    <RemoteTargetDialog
      v-model:selected-id="remoteTarget.selectedId.value"
      v-model:selection="remoteTarget.selection.value"
      :show-engine="remoteTarget.request.value?.action === 'main'"
      :visible="remoteTarget.visible.value"
      :repository-name="remoteTarget.request.value?.repositoryName ?? ''"
      :action="remoteTarget.request.value?.action ?? 'main'"
      :connections="remoteTarget.readyConnections.value"
      :checkouts="remoteTarget.checkouts.value"
      :can-confirm="remoteTarget.canConfirm.value"
      :busy="remoteTarget.busy.value"
      :error="remoteTarget.error.value"
      @close="remoteTarget.close"
      @confirm="remoteTarget.confirm"
    />
    <NewProjectDialog
      :visible="newProjectDialogVisible"
      :busy="newProjectBusy"
      :error="newProjectError"
      @close="closeNewProjectDialog"
      @create="createNewProject"
    />
    <ConversationHistoryDialog
      v-if="resumeSessionAgent"
      :agent="resumeSessionAgent"
      :visible="true"
      :list-conversations="listAgentConversations"
      :resume-conversation="resumeAgentConversation"
      @close="resumeSessionAgentId = null"
    />
    <AgentHandoffDialog
      v-if="handoffAgent"
      :agent="handoffAgent"
      :pending-operation-id="pendingHandoffOperationId"
      :blocker="agentHandoffBlocker(snapshot, handoffAgent)"
      :submit="handoffAgentAction"
      :list-models="listHandoffModels"
      :read-messages="readConversationMessages"
      @close="handoffAgentId = null"
    />
    <ModelFavoritesDialog
      :favorites="managedModelFavorites"
      :models="providerModels"
      :visible="modelFavoritesDialogVisible"
      @change="updateManagedModelFavorites"
      @close="modelFavoritesDialogVisible = false"
    />
    <AgentDialog
      :visible="agentDialogVisible"
      :mode="agentDialogMode"
      :agent="editingAgent"
      :choose-agent-folder="chooseAgentFolder"
      :choose-source-worktree-destination="chooseSourceWorktreeDestination"
      :create-agent="createAgentFromDialog"
      :create-source-worktree="createSourceWorktree"
      :list-source-folders="listSourceFolders"
      :list-source-worktrees="listSourceWorktrees"
      :suggest-source-worktree-path="suggestSourceWorktreePath"
      :initial-agent-name="pendingNewAgentName"
      :initial-new-team-name="pendingNewAgentTeamName"
      :initial-new-worktree-branch-name="pendingNewAgentWorktreeBranchName"
      :initial-source-repository-name="agentDialogSourceRepositoryName"
      :initial-team-id="agentDialogTeamId"
      :source-folder-path="snapshot.sourceFolder.path"
      :source-recent-repo-names="snapshot.sourceFolder.recentRepoNames"
      :source-repositories="sourceRepositories"
      :list-source-repositories="listSourceRepositories"
      :update-agent="updateAgent"
      :teams="snapshot.teams"
      :show-team-field="showAgentDialogTeamSelector"
      @close="closeAgentDialog"
    />
    <TeamDialog
      :visible="teamDialogVisible"
      :mode="teamDialogMode"
      :team="editingTeam"
      :create-team="createTeam"
      :update-team="updateTeam"
      @close="teamDialogVisible = false"
    />
    <KeyboardShortcutsDialog v-if="keyboardShortcutsVisible" :context="shortcutContext" @close="keyboardShortcutsVisible = false" />
    <CommandPalette v-if="commandPaletteVisible" :actions="paletteActions" @close="commandPaletteVisible = false" @execute="executePaletteAction" />
    <WhatsNewDialog
      :visible="whatsNewVisible"
      @close="whatsNewVisible = false"
    />
    <ProvisioningOperationHost />
    <RepositoryDeleteDialog
      v-if="repositoryDeletionAgentId"
      :agent-id="repositoryDeletionAgentId"
      :load-preview="loadRepositoryDeletionPreview"
      :remove-repository="deleteRepositoryAction"
      @close="repositoryDeletionAgentId = null"
    />
    <FeatureGroupDialog v-if="featureDialog && activeTeam" :key="`${activeTeam.id}:${featureDialog.branch}:${featureDialog.mode}`" :feature="{ ...featureDialog, teamId: activeTeam.id }" :mode="featureDialog.mode" :request="featureControl" @close="featureDialog = null" />
    <FeatureWorktreeDialog
      v-if="featureWorktreeRequest"
      :mode="featureWorktreeRequest.mode"
      :fixed-branch="featureWorktreeRequest.branch"
      :repositories="featureWorktreeRequest.repositories"
      :team-id="featureWorktreeRequest.teamId"
      :create-agent="createAgent"
      :create-worktree="createSourceWorktree"
      :list-branches="listSourceBranches"
      :provider-for-host="featureWorktreeBackend"
      @close="featureWorktreeRequest = null"
    />
    <MissionDeleteDialog
      :visible="missionDeleteTarget !== null"
      :mission="missionDeleteTarget"
      :busy="missionDeletePending"
      :error="missionDeleteError"
      @close="closeMissionDeleteDialog"
      @background="backgroundMissionDeletion"
      @confirm="confirmMissionDeletion"
    />
    <CodexResourceSharingMigrationDialog
      :blocked="codexResourceSharingBlocked"
      :pending="codexResourceSharingMigrationPending"
      :visible="codexResourceSharingMigrationRequired"
      @decline="declineCodexResourceSharingMigration"
      @migrate="migrateCodexResources"
    />
    <FileQuickOpen
      v-if="fileQuickOpenVisible"
      :files="agentFiles"
      @close="fileQuickOpenVisible = false"
      @select="currentAgent && openFilePreviewForAgent(currentAgent.id, $event)"
    />
    <AgentQuickOpen
      v-if="agentQuickOpenVisible"
      :agents="quickOpenAgents"
      :missions="quickOpenMissions"
      :repository-icons="snapshot.general.repositoryIcons"
      :teams="snapshot.teams"
      :unread-agent-ids="unreadAgentIds ?? []"
      @close="agentQuickOpenVisible = false"
      @select="selectAgentFromPalette"
      @select-mission="selectMissionFromPalette"
    />
    <ConversationShareDialog v-if="shareTarget" :key="JSON.stringify(shareTarget)" :target="shareTarget" :control="shareControl" @close="shareTarget = null" />
  </main>
</template>

<script setup lang="ts">
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import { conversationForView, conversationPlanForAgent, type ConversationPresentation } from '../provider-conversation-bindings';
import type { PaneMessage } from '../conversation-presentation/presentation';
import { product } from '@workspace/core/product';

import { translate } from '../i18n';
import { localizedErrorMessage, localizedText } from '../i18n/errors';
import { ElMessage, ElMessageBox } from 'element-plus';
import { workProviderDefinition } from '@workspace/core/work-providers';
import { workProviderLabel, workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue';
import { providerUpdatePreviewKey } from './provider-update-preview';
import { forgetDesignHistory, pruneDesignHistory } from './design-history';
import { computerUseLockKey } from './computer-use-lock';
import { codeReviewUncommittedPreviewKey } from './code-review-preview';
import { useI18n } from 'vue-i18n';
import SidebarExpandButton from '../shared/SidebarExpandButton.vue';
import { useCompactViewport } from '../shared/use-compact-viewport';
import type { HarnessProvider, AgentFileActivity } from '@workspace/core/contracts';
import type { AddSshConnectionInput, Agent, AgentCreationProgress, AgentFilePreviewResult, AgentFileSearchItem, AgentGitStatus, AppCommand, ApprovalPreset, AppSnapshot, ProviderApprovalDecision, ProviderApprovalRequest, ProviderApprovalScope, ProviderCapabilities, ProviderCommandSummary, ProviderConnectionState, ProviderConversationRef, ProviderModelOption, ProviderPluginSummary, ProviderRuntimeStatus, ProviderSkillSummary, DaemonStatus, CloneSourceRepositoryInput, ConversationListInput, ConversationResumeTarget, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateProjectInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, DesktopUpdateStatus, DevicePairingSession, DevicePairingStatus, GlobalWorkItemQuery, AutomationLocation, ModelFavorite, MoveAgentToTeamInput, OpenInApplication, OpenInApplicationCatalog, PairedDevice, ReasoningEffort, RendererMessage, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, RendererSendPromptOptions, SetCodexResourceSharingInput, SidePanelRequest, SourceBranch, SourceFolderListing, SourceFolderListInput, SourceRepository, SourceWorktree, SshHostCandidate, Team, ThreadGoal, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkBacklogConfigurationInput, WorkIntegrationConnection, WorkItem, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import { defaultHarnessProvider, defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { defaultProviderCommands } from '@workspace/core/provider-commands';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { agentMentionGroups as projectAgentMentionGroups } from './agent-mention-groups';
import { appApi, appHostCapabilities, appClientPlatform, appPlatformActions } from '../platform-api';
import { windowState } from '../window-state';
import { applyAgentSetup, exportWorkspaceSetup } from './right-workspace-setup';
import { featureAgentIds, featureLabel } from '@workspace/core/feature-groups';
import { agentDisplayName } from '@workspace/core/agent-display';
import { orderAgentsLikeWorktreeSidebar } from '@workspace/core/workspace-sidebar';
import { codeReviewSettingsKey, useCodeReviewSettings } from './code-review-settings';
import { diffVizSettingsKey } from './diff-viz-settings';
import AgentDialog from './AgentDialog.vue';
import ProvisioningOperationHost from './ProvisioningOperationHost.vue';
import type { WorkspaceProvisioningOperation } from './WorkspaceProvisioningProgressDialog.vue';
import { publishProvisioningOperation } from './provisioning-operations';
import RepositorySessionSourceDialog from './RepositorySessionSourceDialog.vue';
import { resolveRepositorySessionContext, type RepositorySessionSource } from './repository-session-context';
import NewSourceWorktreeDialog from './NewSourceWorktreeDialog.vue';
import RepositoryAcquireDialog from './RepositoryAcquireDialog.vue';
import RemoteFolderPickerDialog from './RemoteFolderPickerDialog.vue';
import RemoteTargetDialog from './RemoteTargetDialog.vue';
import { useRemoteTarget, type RemoteTargetRequest } from './use-remote-target';
import NewProjectDialog from './NewProjectDialog.vue';
import { preferredProviderChoices, provideProviderChoices, provideProviderSwitch } from './provider-selection';
import { createGeneralPreferences, generalPreferencesKey } from '../general-preferences';
import BacklogView from './BacklogView.vue';
import ConversationHistoryDialog from './ConversationHistoryDialog.vue';
import AgentHandoffDialog from './AgentHandoffDialog.vue';
import { agentHandoffBlocker, type AgentHandoffInput } from '@workspace/core/agent-handoff';
import { providerSafetyBlockMessage } from '@workspace/core/provider-safety-block';
import FileQuickOpen from './FileQuickOpen.vue';
import AgentQuickOpen from './AgentQuickOpen.vue';
import AutomationsView from './AutomationsView.vue';
import TeamDialog from './TeamDialog.vue';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog.vue';
import CommandPalette from './CommandPalette.vue';
import { commandPaletteActions, type CommandPaletteAction } from './command-palette-actions';
import type { ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import AppShellNavigation from './AppShellNavigation.vue';
import BackendConnectionBanner from './BackendConnectionBanner.vue';
import WhatsNewDialog from './WhatsNewDialog.vue';
import AgentWorkspace from './AgentWorkspace.vue';
import AgentSplitGrid from './AgentSplitGrid.vue';
import AgentHeader from './AgentHeader.vue';
import ConversationShareDialog from './ConversationShareDialog.vue';
import { useConversationSharePresence } from './use-conversation-share-presence';
import { conversationShareTarget, type ConversationShareTarget } from '@workspace/core/conversation-sharing';
import AgentConversationPanel from './AgentConversationPanel.vue';
import { provideConversationAnnotationDrafts } from './conversation-annotation-drafts';
import SharedConversationPane from './SharedConversationPane.vue';
import SplitLayoutControl from './SplitLayoutControl.vue';
import { useSplitWorkspace } from './use-split-workspace';
import type { AgentConversationActions } from './use-agent-conversation';
import { type ConversationMenuCommand } from './conversation-command-menu';
import type { AgentConversationView } from '../app-state';
import MissionCodeReview from './MissionCodeReview.vue';
import MissionShipBoard from './MissionShipBoard.vue';
import MissionWorkspace from './MissionWorkspace.vue';
import MissionDocumentRequest from './MissionDocumentRequest.vue';
import { useMissionDocuments } from './use-mission-documents';
import FeatureGroupDialog from './FeatureGroupDialog.vue';
import FeatureWorktreeDialog from './FeatureWorktreeDialog.vue';
import type { SidebarRepositoryTarget } from './agent-sidebar-contracts';
import MissionDeleteDialog from './MissionDeleteDialog.vue';
import RepositoryDeleteDialog from './RepositoryDeleteDialog.vue';
import type { DeleteRepositoryInput } from '@workspace/core/contracts/workspace';
import type { MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';
import { useDebugProviderSafetyBlock } from './debug-provider-safety-block';
import { useDebugWorktreeInitialization } from './debug-worktree-initialization';
import AppMenu from '../shared/menu/AppMenu.vue';
import { missionAgentIds, navigationUnreadAgentIds } from '@workspace/core/mission-attention';
import type { Mission, MissionStage, CreateMissionInput, DeleteMissionInput } from '@workspace/core/missions';
import { missionCreatedWorkspaces, type MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import SettingsView from './SettingsView.vue';
import { telemetryNoticeReadyKey } from './use-telemetry-consent';
import FirstRunOnboardingGate from './FirstRunOnboardingGate.vue';
import CodexResourceSharingMigrationDialog from './CodexResourceSharingMigrationDialog.vue';
import ModelFavoritesDialog from './ModelFavoritesDialog.vue';
import type { SettingsTab } from './settings-tabs';
import {
  type ConversationLink,
  type ConversationPaneActions,
  type ConversationVisualization,
  type ComposerMenuItem,
  type ComposerMentionGroup,
  type MessageImage,
  type MessageImageContext,
  type NativeAttachment,
  type ComposerState,
  type QueuedPromptData as QueuedChatPrompt,
} from '@korus-dev/agent-ui-sdk';
import { normalizePromptContent } from '@korus-dev/multi-agent-sdk/prompt';
import type { ThreadFlagResponse } from '@workspace/core/thread-flags';
import { BacklogIcon, BoltIcon, PencilIcon, PlusIcon } from '../shared/icons/app-icons';
import {
  copyModelFavorite,
  modelFavoriteEffortLabel,
  modelFavoriteFastTierLabel,
  modelFavoriteKey,
  modelFavoriteModelLabel,
  sameModelFavorite,
} from './model-favorites';
import { useFirstRunOnboarding } from './use-first-run-onboarding';
import { useRepositoryAcquisition } from './use-repository-acquisition';
import { useRepositorySession } from './use-repository-session';
import { useDocumentSaveAs } from './use-document-save-as';
import { useDocumentWorkspaces } from './use-document-workspaces';
import { useRightWorkspaceState } from './use-right-workspace-state';
import { useCollapsiblePaneResize } from '../shared/use-collapsible-pane-resize';
import type { RightWorkspaceTab } from './right-workspace';
import { useCockpitBacklog } from './use-cockpit-backlog';
import { provideBacklogConnections } from './backlog-providers';
import { useWorkspacePreviews } from './use-workspace-previews';
import { downloadAgentFile } from '../download-agent-file';
import AppContextMenu from '../shared/menu/AppContextMenu.vue';
import { useConversationFileActions } from './use-conversation-file-actions';
import { useWorkItemRouting } from './use-work-item-routing';
import { useAppShellCommands } from './use-app-shell-commands';

const props = withDefaults(defineProps<{
  guestState?: import('@workspace/core/guest-navigation').GuestJoinState;
  guestBusy?: boolean;
  guestControl?: (input: import('@workspace/core/guest-navigation').GuestJoinControl) => Promise<boolean>;
  snapshot: AppSnapshot;
  activeAgent: Agent | null;
  unreadAgentIds?: string[];
  agentFiles?: AgentFileSearchItem[];
  /** Reads the active agent's workspace files again; the list is otherwise loaded once when the agent is opened. */
  loadAgentFiles?: () => Promise<void>;
  isLoading: boolean;
  isConversationLoading?: boolean;
  isConversationLoadFailed?: boolean;
  historyHasOlder?: boolean;
  historyLoadingOlder?: boolean;
  isSending: boolean;
  connectionState?: ProviderConnectionState;
  goal?: ThreadGoal | null;
  approvals?: ProviderApprovalRequest[];
  permissionMode?: string | null;
  answeredClientRequestIds?: Set<string>;
  providerModels?: ProviderModelOption[];
  providerCommands?: ProviderCommandSummary[];
  providerPlugins?: ProviderPluginSummary[];
  providerSkills?: ProviderSkillSummary[];
  providerCapabilities?: ProviderCapabilities;
  conversationPresentation?: ConversationPresentation | null;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedServiceTier?: string | null;
  planMode?: boolean;
  queuedPrompts?: QueuedChatPrompt[];
  composerState?: ComposerState;
  composerAttachments?: readonly NativeAttachment[];
  updateStatus?: DesktopUpdateStatus;
  sidePanelRequest?: SidePanelRequest | null;
  markdownDisplayRequests?: Array<Extract<SidePanelRequest, { kind: 'markdown' }>>;
  fileActivity?: AgentFileActivity | null;
  workProviderAuthorization?: WorkProviderAuthorization | null;
  workProviderAuthorizations?: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  workProviderAuthorizationErrors?: Partial<Record<WorkProviderKind, string>>;
  workRepositoriesByProvider?: Partial<Record<WorkProviderKind, WorkSource[]>>;
  workItemsByRepository?: Record<string, WorkItem[]>;
  assignedWorkItemsByProvider?: Partial<Record<WorkProviderKind, WorkItem[]>>;
  workBacklogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  workBacklogError?: string | null;
  workBacklogStateFor?: (provider: WorkProviderKind) => { status: 'notLoaded' | 'loading' | 'loaded' | 'error'; error: string | null };
  daemonStatus?: DaemonStatus | null;
  daemonStatusError?: string | null;
  codexResourceSharingMigrationRequired?: boolean;
  chooseAgentFolder?: () => Promise<string | null>;
  chooseSourceFolder?: () => Promise<string | null>;
  listSourceFolders?: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  sourceRepositories?: SourceRepository[];
  listSourceRepositories?: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  cloneSourceRepository?: (input: CloneSourceRepositoryInput) => Promise<SourceRepository>;
  createProject?: (input: CreateProjectInput) => Promise<void>;
  listSourceBranches?: (repoPath: string, remoteConnectionId?: string) => Promise<SourceBranch[]>;
  listSourceWorktrees?: (repoPath: string, remoteConnectionId?: string) => Promise<SourceWorktree[]>;
  suggestSourceWorktreePath?: (input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>) => Promise<string>;
  chooseSourceWorktreeDestination?: (defaultPath: string) => Promise<string | null>;
  createSourceWorktree?: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  previewAgentFile?: (agentId: string, filePath: string) => Promise<AgentFilePreviewResult>;
  getAgentGitDiff?: (agentId: string, target?: import('@workspace/core/contracts').AgentGitDiffTarget) => Promise<import('@workspace/core/contracts').AgentGitDiff>;
  getAgentGitWorkflow?: (agentId: string, options?: { includePullRequest?: boolean }) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  generateAgentGitMessage?: (agentId: string, input: import('@workspace/core/contracts').AgentGitMessageGenerationInput) => Promise<import('@workspace/core/contracts').AgentGitMessageGenerationResult>;
  stageAgentGitFiles?: (agentId: string, input: import('@workspace/core/contracts').AgentGitStageInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  commitAgentGitChanges?: (agentId: string, input: import('@workspace/core/contracts').AgentGitCommitInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  pushAgentGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPushInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  createAgentGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitBranchInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  createAgentGitPullRequest?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPullRequestInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  mergeAgentGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitMergeInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  updateAgentGitBranchFromBase?: (agentId: string, input: import('@workspace/core/contracts').AgentGitUpdateFromBaseInput) => Promise<import('@workspace/core/contracts').AgentGitUpdateFromBaseResult>;
  pullAgentGitBranch?: (agentId: string, input: import('@workspace/core/contracts').AgentGitPullInput) => Promise<import('@workspace/core/contracts').AgentGitPullResult>;
  revertAgentGitChanges?: (agentId: string, input: import('@workspace/core/contracts').AgentGitRevertInput) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
  openInApplications?: OpenInApplicationCatalog;
  openAgentPath?: (agentId: string, application: OpenInApplication, filePath?: string) => Promise<void>;
  createAgent?: (input: CreateAgentInput, navigation?: { select?: boolean }) => Promise<Agent | null | void>;
  createMission?: (input: CreateMissionInput) => Promise<Mission>;
  selectMission?: (missionId: string | null) => Promise<void>;
  featureControl?: (input: import('@workspace/core/feature-groups').FeatureGroupRequest) => Promise<import('@workspace/core/feature-groups').FeatureGroupResult>;
  deleteMission?: (input: DeleteMissionInput) => Promise<void>;
  deleteRepositoryAction?: (agentId: string, input: DeleteRepositoryInput) => Promise<void>;
  readMissionArtifact?: (missionId: string, stage: import('@workspace/core/missions').MissionStage) => Promise<import('@workspace/core/mission-execution').MissionArtifactReadResult>;
  executeMission?: (input: import('@workspace/core/mission-execution').MissionExecutionInput) => Promise<void>;
  missionImplementationStartProgress?: MissionImplementationStartProgress | null;
  /** An agent asked to open this Mission (from `create-mission`). */
  missionFocusRequest?: { missionId: string; sequence: number } | null;
  agentCreationProgresses?: AgentCreationProgress[];
  createQuickChat?: (input: CreateQuickChatInput) => Promise<Agent | null | void>;
  createTeam?: (input: CreateTeamInput) => Promise<Team | null | void>;
  updateTeam?: (input: UpdateTeamInput) => Promise<void>;
  updateAgent?: (input: UpdateAgentInput) => Promise<void>;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
  setCodexResourceSharing?: (input: SetCodexResourceSharingInput) => Promise<void>;
  getPluginStatus?: () => Promise<import('@workspace/core/contracts').AppPluginStatus>;
  listSshHosts?: () => Promise<SshHostCandidate[]>;
  addSshConnection?: (input: AddSshConnectionInput) => Promise<void>;
  checkRemoteConnection?: (connectionId: string, inspectOnly?: boolean, backends?: HarnessProvider[]) => Promise<void>;
  updateRemoteConnection?: (connectionId: string, input: UpdateRemoteConnectionInput) => Promise<void>;
  removeRemoteConnection?: (connectionId: string) => Promise<void>;
  companionControl?: (input: import('@workspace/core/companion-protocol').CompanionControl) => Promise<import('@workspace/core/companion-protocol').CompanionControlResult>;
  getRemoteControlStatus?: () => Promise<DevicePairingStatus>;
  enableRemoteControl?: () => Promise<DevicePairingStatus>;
  disableRemoteControl?: () => Promise<DevicePairingStatus>;
  startDevicePairing?: () => Promise<DevicePairingSession>;
  checkDevicePairing?: (session: DevicePairingSession) => Promise<boolean>;
  listPairedDevices?: (environmentId: string) => Promise<PairedDevice[]>;
  revokePairedDevice?: (environmentId: string, clientId: string) => Promise<void>;
  setDaemonEnabled?: (enabled: boolean) => Promise<void>;
  restartApp?: () => Promise<void>;
  getAutomationSnapshot?: (location?: AutomationLocation) => Promise<AppSnapshot>;
  createAutomation?: (input: CreateAutomationInput, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  updateAutomation?: (input: UpdateAutomationInput, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  runAutomation?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  clearAutomationHistory?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  deleteAutomationExecution?: (automationId: string, executionId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  deleteAutomation?: (automationId: string, location?: AutomationLocation) => Promise<AppSnapshot | void>;
  listAgentConversations?: (agentId: string, input?: ConversationListInput) => Promise<ConversationSummary[]>;
  resumeAgentConversation?: (agentId: string, target: ConversationResumeTarget) => Promise<void>;
  handoffAgentAction?: (agentId: string, input: AgentHandoffInput) => Promise<void>;
  readConversationMessages?: (ref: ProviderConversationRef, agentId: string, location?: AutomationLocation) => Promise<RendererMessage[]>;
  connectWorkProvider?: (provider: WorkProviderKind, options?: import('@workspace/core/contracts').WorkProviderConnectOptions) => Promise<void>;
  openWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  pollWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  disconnectWorkProvider?: (provider: WorkProviderKind) => Promise<void>;
  configureWorkBacklog?: (input: WorkBacklogConfigurationInput) => Promise<void>;
  listWorkSources?: (provider: WorkProviderKind, location?: AutomationLocation) => Promise<WorkSource[]>;
  loadWorkRepositories?: (provider: WorkProviderKind, location?: AutomationLocation) => Promise<WorkSource[] | void>;
  loadWorkItems?: (provider: WorkProviderKind, repositoryId: string, location?: AutomationLocation, query?: WorkItemQuery) => Promise<WorkItem[] | void>;
  loadGlobalWorkItems?: (provider: WorkProviderKind, location?: AutomationLocation, query?: GlobalWorkItemQuery) => Promise<WorkItemPage>;
  loadAssignedWorkItems?: (provider: WorkProviderKind, location?: AutomationLocation) => Promise<WorkItem[] | void>;
  duplicateAgentAction?: (agentId: string, options?: import('@workspace/core/contracts').DuplicateAgentOptions) => Promise<Agent | null>;
  assignWorkItemAction?: (payload: { agentId: string; item: WorkItem; prompt?: string }) => Promise<void>;
  loadOlderAgentHistory?: (agentId: string) => Promise<void>;
  loadAgentTurnHistory?: (agentId: string, turnId: string) => Promise<void>;
  retryAgentHistory?: () => Promise<void>;
  agentConversationFor?: (agentId: string) => AgentConversationView | null;
  agentConversationActions?: AgentConversationActions;
  sendPromptAction?: (prompt: string, options?: RendererSendPromptOptions) => Promise<void>;
  updatePlanReview?: (agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) => Promise<import('@workspace/core/plan-review').PlanReview>;
  respondToThreadFlagAction?: (response: ThreadFlagResponse) => Promise<void>;
  deleteTurnAction?: (turnId: string) => Promise<void>;
  editTurnAction?: (payload: { content: string; turnId: string; options?: Pick<RendererSendPromptOptions, 'content'> }) => Promise<void>;
  retryTurnAction?: (turnId: string) => Promise<void>;
  continueInterruptedTurnAction?: () => Promise<void>;
  quit?: () => Promise<void>;
  startCodeReview?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewStartInput) => Promise<AppSnapshot>;
  decideCodeReviewFinding?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewDecisionInput) => Promise<AppSnapshot>;
  discussCodeReviewFinding?: (agentId: string, input: import('@workspace/core/code-review').CodeReviewDiscussionInput) => Promise<AppSnapshot>;
  submitCodeReviewRound?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  finishCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  commitCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  discardCodeReview?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  reviewCodeAgain?: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  startVisualize?: (agentId: string, input?: import('@workspace/core/visualize').StartVisualizeInput) => Promise<AppSnapshot>;
  setVisualizeOpen?: (agentId: string, input: import('@workspace/core/visualize').SetVisualizeOpenInput) => Promise<AppSnapshot>;
  generateVisualizationSuggestion?: (agentId: string, input: import('@workspace/core/visualize').GenerateVisualizationSuggestionInput) => Promise<AppSnapshot>;
  selectVisualization?: (agentId: string, input: import('@workspace/core/visualize').SelectVisualizationInput) => Promise<AppSnapshot>;
  deleteVisualization?: (agentId: string, input: import('@workspace/core/visualize').DeleteVisualizationInput) => Promise<AppSnapshot>;
  readVisualizationAsset?: (agentId: string, visualizationId: string) => Promise<import('@workspace/core/visualize').VisualizationAsset>;
}>(), {
  answeredClientRequestIds: () => new Set<string>(),
  approvals: () => [],
  agentFiles: () => [],
  providerModels: () => [],
  providerCommands: () => [],
  providerPlugins: () => [],
  providerSkills: () => [],
  providerCapabilities: () => defaultProviderCapabilities(defaultHarnessProvider),
  isConversationLoading: false,
  isConversationLoadFailed: false,
  historyHasOlder: true,
  historyLoadingOlder: false,
  connectionState: () => ({ status: 'connected' }),
  modelCatalogStatus: 'notLoaded',
  skillCatalogStatus: 'notLoaded',
  selectedModelId: null,
  selectedReasoningEffort: null,
  selectedServiceTier: null,
  permissionMode: null,
  queuedPrompts: () => [],
  composerState: () => ({ text: '', selectionStart: 0, selectionEnd: 0 }),
  composerAttachments: () => [],
  sidePanelRequest: null,
  markdownDisplayRequests: () => [],
  fileActivity: null,
  workProviderAuthorization: null,
  workRepositoriesByProvider: () => ({}),
  workItemsByRepository: () => ({}),
  assignedWorkItemsByProvider: () => ({}),
  workBacklogStatus: 'notLoaded',
  workBacklogError: null,
  startCodeReview: async () => { throw new Error('Code review is not available.'); },
  decideCodeReviewFinding: async () => { throw new Error('Code review is not available.'); },
  discussCodeReviewFinding: async () => { throw new Error('Code review is not available.'); },
  submitCodeReviewRound: async () => { throw new Error('Code review is not available.'); },
  finishCodeReview: async () => { throw new Error('Code review is not available.'); },
  commitCodeReview: async () => { throw new Error('Code review is not available.'); },
  discardCodeReview: async () => { throw new Error('Code review is not available.'); },
  reviewCodeAgain: async () => { throw new Error('Code review is not available.'); },
  startVisualize: async () => { throw new Error('Visualize is not available.'); },
  setVisualizeOpen: async () => { throw new Error('Visualize is not available.'); },
  generateVisualizationSuggestion: async () => { throw new Error('Visualize is not available.'); },
  selectVisualization: async () => { throw new Error('Visualize is not available.'); },
  deleteVisualization: async () => { throw new Error('Visualize is not available.'); },
  readVisualizationAsset: async () => { throw new Error('Visualize is not available.'); },
  daemonStatus: null,
  daemonStatusError: null,
  codexResourceSharingMigrationRequired: false,
  chooseAgentFolder: async () => null,
  chooseSourceFolder: async () => null,
  listSourceFolders: async () => ({ path: '', parentPath: null, entries: [] }),
  sourceRepositories: () => [],
  listSourceRepositories: async () => [],
  cloneSourceRepository: async () => { throw new Error(translate('surface.appShell.repositoryCloningIsNotAvailable')); },
  createProject: async () => { throw new Error(translate('surface.appShell.repositoryCreationIsNotAvailable')); },
  listSourceBranches: async () => [],
  suggestSourceWorktreePath: async () => '',
  chooseSourceWorktreeDestination: async () => null,
  createSourceWorktree: async () => ({ name: '', path: '' }),
  previewAgentFile: async () => {
    throw new Error(translate('surface.appShell.filePreviewIsNotAvailable'));
  },
  getAgentGitDiff: async () => {
    throw new Error(translate('surface.appShell.gitDiffPreviewIsNotAvailable'));
  },
  getAgentGitWorkflow: async () => { throw new Error(translate('surface.appShell.gitWorkflowIsNotAvailable')); },
  generateAgentGitMessage: async () => { throw new Error(translate('surface.appShell.gitMessageGenerationIsNotAvailable')); },
  stageAgentGitFiles: async () => { throw new Error(translate('surface.appShell.gitStagingIsNotAvailable')); },
  commitAgentGitChanges: async () => { throw new Error(translate('surface.appShell.gitCommitIsNotAvailable')); },
  pushAgentGitBranch: async () => { throw new Error(translate('surface.appShell.gitPushIsNotAvailable')); },
  createAgentGitBranch: async () => { throw new Error(translate('surface.appShell.gitBranchCreationIsNotAvailable')); },
  createAgentGitPullRequest: async () => { throw new Error(translate('surface.appShell.pullRequestCreationIsNotAvailable')); },
  mergeAgentGitBranch: async () => { throw new Error(translate('surface.appShell.gitMergeIsNotAvailable')); },
  updateAgentGitBranchFromBase: async () => { throw new Error(translate('surface.appShell.gitUpdateFromBaseIsNotAvailable')); },
  openInApplications: () => ({ defaultApplication: 'finder', applications: [] }),
  openAgentPath: async () => {
    throw new Error(translate('surface.appShell.openInIsNotAvailable'));
  },
  createAgent: async () => undefined,
  createMission: async () => { throw new Error('Missions unavailable.'); },
  selectMission: async () => undefined,
  featureControl: async () => { throw new Error('Feature operations unavailable.'); },
  deleteMission: async () => { throw new Error('Missions unavailable.'); },
  deleteRepositoryAction: async () => { throw new Error('Repository deletion unavailable.'); },
  readMissionArtifact: async () => { throw new Error('Mission artifacts unavailable.'); },
  createQuickChat: async () => undefined,
  createTeam: async () => undefined,
  updateTeam: async () => undefined,
  updateAgent: async () => undefined,
  updateSettings: async () => undefined,
  setCodexResourceSharing: async () => undefined,
  getPluginStatus: async () => ({ chromeEnabled: false }),
  listSshHosts: async () => [],
  addSshConnection: async () => undefined,
  checkRemoteConnection: async () => undefined,
  updateRemoteConnection: async () => undefined,
  removeRemoteConnection: async () => undefined,
  getRemoteControlStatus: async () => ({ status: 'disabled' as const }),
  enableRemoteControl: async () => ({ status: 'disabled' as const }),
  disableRemoteControl: async () => ({ status: 'disabled' as const }),
  startDevicePairing: async () => ({ pairingCode: '', environmentId: '', expiresAt: '' }),
  checkDevicePairing: async () => false,
  listPairedDevices: async () => [],
  revokePairedDevice: async () => undefined,
  setDaemonEnabled: async () => undefined,
  restartApp: async () => undefined,
  getAutomationSnapshot: async () => createEmptySnapshot(),
  createAutomation: async () => undefined,
  updateAutomation: async () => undefined,
  runAutomation: async () => undefined,
  clearAutomationHistory: async () => undefined,
  deleteAutomationExecution: async () => undefined,
  deleteAutomation: async () => undefined,
  listAgentConversations: async () => [],
  resumeAgentConversation: async () => undefined,
  handoffAgentAction: async () => { throw new Error('Handoff is unavailable.'); },
  readConversationMessages: async () => [],
  connectWorkProvider: async () => undefined,
  openWorkProviderAuthorization: async () => undefined,
  pollWorkProviderAuthorization: async () => undefined,
  disconnectWorkProvider: async () => undefined,
  configureWorkBacklog: async () => undefined,
  loadWorkRepositories: async () => undefined,
  loadWorkItems: async () => undefined,
  loadGlobalWorkItems: async () => ({ items: [] }),
  loadAssignedWorkItems: async () => undefined,
  duplicateAgentAction: async () => null,
  assignWorkItemAction: async () => undefined,
  retryAgentHistory: async () => undefined,
  quit: async () => undefined,
});

const emit = defineEmits<{
  'visible-agents-change': [agentIds: string[]];
  'join-invite': [];
  'clear-agent-creation-progress': [id: string];
  'background-agent-creation-progress': [id: string];
  'consume-markdown-displays': [count: number];
  'close-team': [teamId: string];
  'close-agent': [agentId: string];
  'compress-session': [agentId: string];
  'cleanup-pull-request': [agentId: string];
  'clear-goal': [];
  'agent-response': [response: AgentRequestResponse];
  'delete-turn': [turnId: string];
  'delete-queued-prompt': [promptId: string];
  'debug-mark-unread': [];
  'duplicate-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'fork-turn': [turnId: string];
  'edit-turn': [payload: { content: string; turnId: string; options?: Pick<RendererSendPromptOptions, 'content'> }];
  'interrupt-agent': [];
  'move-agent-to-team': [input: MoveAgentToTeamInput];
  'reorder-agents': [input: ReorderAgentsInput];
  'reorder-repositories': [input: ReorderRepositoriesInput];
  'reorder-teams': [input: ReorderTeamsInput];
  'assign-work-item': [payload: { agentId: string; item: WorkItem }];
  'remove-work-item-assignment': [item: WorkItem];
  'restart-agent': [agentId: string];
  'resolve-approval': [approvalId: string, decision: ProviderApprovalDecision, scope: ProviderApprovalScope];
  'retry-turn': [turnId: string];
  'send-agent-prompt': [payload: { agentId: string; prompt: string }];
  'select-agent': [agentId: string];
  'select-model': [modelId: string];
  'select-reasoning-effort': [reasoningEffort: ReasoningEffort];
  'select-service-tier': [serviceTier: string | null];
  'select-permission-mode': [mode: string];
  'select-team': [teamId: string];
  'steer-queued-prompt': [promptId: string, prompt?: string, options?: Pick<RendererSendPromptOptions, 'content'>];
  'update-queued-prompt': [promptId: string, prompt: string, options?: Pick<RendererSendPromptOptions, 'content'>];
  'update:planMode': [enabled: boolean];
  'update:composerState': [payload: { agentId: string; state: ComposerState }];
  'update:composerAttachments': [payload: { agentId: string; attachments: readonly NativeAttachment[] }];
  'install-update': [];
  sendPrompt: [prompt: string, options?: RendererSendPromptOptions];
  steerPrompt: [prompt: string, options?: RendererSendPromptOptions];
}>();

const { t } = useI18n();

type PendingReviewClarification = {
  agentId: string;
  sessionId: string;
  roundId: string;
  findingId: string;
  finding: import('@workspace/core/code-review').CodeReviewFinding;
};
type PendingMissionReviewDiscussion = {
  agentId: string;
  finding: import('@workspace/core/missions').MissionReviewFinding;
};

type AppSurface = 'mission' | 'agent' | 'backlog' | 'automations' | 'settings';
provide(computerUseLockKey, {
  state: computed(() => {
    const plugins = props.snapshot.general.plugins;
    return { visible: plugins?.computerUseEnabled === true && plugins.computerUseLockPrevention === 'onDemand', hold: plugins?.computerUseLockHold ?? false };
  }),
  setHold: hold => props.updateSettings({ general: { plugins: { computerUseLockHold: hold } } }).catch(error => { ElMessage.error(localizedErrorMessage(error, t)); }),
});
provide(generalPreferencesKey, createGeneralPreferences(() => props.snapshot.general, general => props.updateSettings({ general })));
provideProviderChoices(() => props.snapshot, openSettings);
const reviewSettings = useCodeReviewSettings();
provide(codeReviewSettingsKey, { ...reviewSettings, preferences: () => props.snapshot.general.codeReviewDefaults });
provide(diffVizSettingsKey, () => props.snapshot.general);
provideBacklogConnections(() => props.snapshot.workBacklog.connections);
const backendSwitch = provideProviderSwitch((id, backend) => props.updateAgent({ id, selection: { provider: backend } }));
const agentSidebarCollapsed = ref(false);
// A window can show less than the whole workspace: a team or a feature without the rail, or one agent without any navigation.
const windowScope = computed(() => windowState.scope.value);
const featureWindow = computed(() => windowScope.value === 'feature');
const missionWindow = computed(() => windowScope.value === 'mission');
// A feature is a branch of a team: its agents are whatever the team has on it now, so new ones show up.
const featureAgents = computed(() => featureAgentIds(props.snapshot.agents, windowState.teamId.value, windowState.branch.value ?? ''));
const chromeless = computed(() => windowScope.value === 'agent' || missionWindow.value);
const hideTeamRail = computed(() => windowScope.value !== 'workspace');
function openInNewWindow(viewState: import('@workspace/core/windows').WindowViewState): void {
  void appApi?.openWindow?.(viewState).catch((error) => ElMessage.error(localizedErrorMessage(error, t)));
}
const openAgentWindow = (agentId: string): void => openInNewWindow({ agentId, scope: 'agent' });
const openTeamWindow = (teamId: string): void => openInNewWindow({ teamId, scope: 'team' });
function openFeatureWindow(branch: string): void {
  const teamId = activeTeam.value?.id;
  const agentId = featureAgentIds(props.snapshot.agents, teamId, branch)[0];
  if (teamId && agentId) openInNewWindow({ scope: 'feature', teamId, branch, agentId });
}
function openMissionWindow(missionId: string): void {
  const mission = props.snapshot.missions?.find(candidate => candidate.id === missionId);
  if (mission) openInNewWindow({ scope: 'mission', teamId: mission.teamId, missionId });
}
const compactViewport = useCompactViewport();
const compactNavOpen = ref(false);
function collapseSidebar(): void {
  if (compactViewport.value) compactNavOpen.value = false;
  else agentSidebarCollapsed.value = true;
}
function expandSidebar(): void {
  if (compactViewport.value) compactNavOpen.value = true;
  else agentSidebarCollapsed.value = false;
}
const pendingReviewClarification = ref<PendingReviewClarification | null>(null);
const codexResourceSharingMigrationPending = ref(false);
const agentListCompact = computed(() => props.snapshot.general.agentListCompact);
const codexResourceSharingBlocked = computed(() => props.snapshot.agents.some((agent) => (
  agent.status.type === 'working' ||
  agent.status.type === 'awaitingInput'
)));
const agentSidebarMinWidth = 200;
const agentSidebarMaxWidth = 420;
const agentSidebarWidth = ref(260);
const { start: startSidebarResize } = useCollapsiblePaneResize();
function startAgentSidebarResize(event: PointerEvent): void {
  const width = agentSidebarWidth.value;
  const startX = event.clientX;
  startSidebarResize(event, {
    minimum: agentSidebarMinWidth,
    width,
    widthAt: move => width + move.clientX - startX,
    resize: setAgentSidebarWidth,
    setOpen: open => { if (open) expandSidebar(); else collapseSidebar(); },
  });
}
const missionSurfaceStorageKey = 'app.activeMissionId';
function rememberedMissionId(): string | null {
  try {
    return window.localStorage.getItem(missionSurfaceStorageKey)?.trim() || null;
  } catch {
    return null;
  }
}
function rememberMissionId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(missionSurfaceStorageKey, id);
    else window.localStorage.removeItem(missionSurfaceStorageKey);
  } catch {
    // Client-local navigation still works when browser storage is unavailable.
  }
}
let pendingMissionRestoreId = rememberedMissionId();
const activeHost = ref<AppSurface>('agent');
const cockpitScope = ref(false);
const settingsReturnMissionId = ref<string | null>(null);
const missionViewedStage = ref<MissionStage>();
const missionCreationError = ref('');
const missionCreationPending = ref(false);
const missionDeleteTargetId = ref<string | null>(null);
const missionDeleteOperations = reactive(new Map<string, { backgrounded: boolean }>());
const missionDeletePending = computed(() => missionDeleteTargetId.value !== null && missionDeleteOperations.has(missionDeleteTargetId.value));
const missionDeleteError = ref('');
const selectedMissionId = ref<string | null>(null);
const selectedMission = computed(() => props.snapshot.missions?.find(m => m.id === selectedMissionId.value) ?? null);
watch(() => selectedMission.value?.stage, (stage, previousStage) => {
  if (stage && previousStage && stage !== previousStage) missionViewedStage.value = stage;
});
const missionIssuePickerVisible = ref(false);
const missionIssueLoading = ref(false);
const missionIssueError = ref<string | null>(null);
const missionSourceMenuItems = computed(() => [{ id: 'issue', type: 'action' as const, label: t('missions.chooseIssue'), icon: BacklogIcon }]);

function missionIssueRepositoryIdentities(mission: Mission): Set<string> {
  const team = props.snapshot.teams.find(candidate => candidate.id === mission.teamId);
  const workerIds = new Set((props.snapshot.missions ?? []).flatMap(candidate => (
    candidate.execution?.runs.flatMap(run => run.workerId && run.workerId !== run.memberId ? [run.workerId] : []) ?? []
  )));
  const representedPaths = new Set<string>();
  const identities = new Set<string>();
  for (const agentId of team?.agentIds ?? []) {
    if (workerIds.has(agentId)) continue;
    const agent = props.snapshot.agents.find(candidate => candidate.id === agentId && candidate.teamId === team?.id);
    if (!agent) continue;
    if (agent.folder) representedPaths.add(agent.folder);
    if (agent.workspace?.kind === 'git') {
      representedPaths.add(agent.workspace.primaryWorktreeRoot);
      representedPaths.add(agent.workspace.repositoryRoot);
      const identity = agent.workspace.originUrl && canonicalGitRemoteIdentity(agent.workspace.originUrl);
      if (identity) identities.add(identity.toLocaleLowerCase());
    }
    const githubRepository = props.snapshot.agentGitStatuses[agentId]?.githubRepository;
    if (githubRepository) identities.add(`github.com/${githubRepository}`.toLocaleLowerCase());
  }
  for (const repository of props.sourceRepositories) {
    if (repository.remoteIdentity && repository.worktrees.some(worktree => representedPaths.has(worktree.path))) {
      identities.add(repository.remoteIdentity.toLocaleLowerCase());
    }
  }
  return identities;
}

function acceptMissionSource(source: WorkSource): boolean {
  if (!workProviderDefinition(source.provider).repositoryBacked) return true;
  const mission = selectedMission.value;
  const identity = canonicalGitRemoteIdentity(source.url);
  return Boolean(mission && identity && missionIssueRepositoryIdentities(mission).has(identity.toLocaleLowerCase()));
}

function openMissionIssuePicker(): void {
  if (!selectedMission.value) return;
  missionIssueError.value = null;
  missionIssuePickerVisible.value = true;
}

function closeMissionIssuePicker(): void {
  missionIssuePickerVisible.value = false;
}

async function chooseMissionIssue(item: WorkItem): Promise<void> {
  const mission = selectedMission.value;
  if (!mission || mission.stage !== 'requirements' || missionIssueLoading.value
    || !missionIssuePickerVisible.value || item.kind === 'pullRequest') return;
  missionIssueLoading.value = true;
  missionIssueError.value = null;
  try {
    const issueContext = `Shape this Mission from ${workProviderLabel(item.provider)} issue ${workItemDisplayIdentifier(item)}: ${item.title}\nBacklog source: ${item.sourceName}\nWork item ID: ${workItemAssignmentKey(item)}\n${item.url}`;
    const issueBody = item.body?.trim().slice(0, 16_000);
    await forwardPrompt(issueBody ? `${issueContext}\n\n${issueBody}` : issueContext);
    closeMissionIssuePicker();
  } catch (caught) {
    missionIssueError.value = localizedErrorMessage(caught, t);
  } finally {
    missionIssueLoading.value = false;
  }
}
const missionOpenInAvailable = computed(() => {
  const mission = selectedMission.value;
  if (!mission || props.openInApplications.applications.length === 0) return false;
  return props.snapshot.teams.some(candidate => candidate.id === mission.teamId);
});
function openMissionWorktree(request: MissionWorkspaceOpenRequest): void {
  void openAgentIn(request.agentId, request.application, request.path);
}
const missionDeleteTarget = computed(() => props.snapshot.missions?.find(m => m.id === missionDeleteTargetId.value) ?? null);
function selectMissionSurface(id: string): void {
  if (selectedMissionId.value !== id) missionViewedStage.value = undefined;
  selectedMissionId.value = id;
  activeHost.value = 'mission';
}
watch(
  () => activeHost.value === 'mission' ? selectedMissionId.value : null,
  missionId => { closeMissionIssuePicker(); if (!missionWindow.value) rememberMissionId(missionId); void props.selectMission(missionId); },
);
function missionTeamContext(): { team: Team; orchestrator: Agent } {
  const team = activeTeam.value;
  const activeAgent = currentAgent.value;
  const orchestrator = activeAgent && activeAgent.teamId === team?.id
    ? activeAgent
    : activeTeamAgents.value[0];
  if (!team || !orchestrator) throw new Error(translate('missions.teamContextRequired'));
  return { team, orchestrator };
}
async function selectMission(id: string): Promise<void> {
  if (missionWindow.value && id !== windowState.missionId.value) return;
  const mission = props.snapshot.missions?.find(mission => mission.id === id);
  if (!mission || (!cockpitScope.value && mission.teamId !== activeTeam.value?.id)) return;
  if (mission.teamId !== activeTeam.value?.id) emit('select-team', mission.teamId);
  selectMissionSurface(id);
}
async function createNewMission() {
  if (missionCreationPending.value) return;
  missionCreationPending.value = true;
  missionCreationError.value = '';
  try {
    const { team, orchestrator } = missionTeamContext();
    const mission = await props.createMission({
      outcome: translate('missions.new'),
      workflowType: 'shapeAndShipFeature',
      teamId: team.id,
      orchestratorMemberId: orchestrator.id,
    });
    selectMissionSurface(mission.id);
  } catch (error) {
    missionCreationError.value = error instanceof Error ? error.message : String(error);
  } finally {
    missionCreationPending.value = false;
  }
}

const repositoryDeletionAgentId = ref<string | null>(null);
async function loadRepositoryDeletionPreview(agentId: string) {
  if (!appApi?.previewRepositoryDeletion) throw new Error('Repository deletion unavailable.');
  return appApi.previewRepositoryDeletion(agentId);
}

const featureDialog = ref<{ branch: string; label: string; mode: 'rename' | 'delete' } | null>(null);
const featureWorktreeRequest = ref<{ mode: 'worktree' | 'agent'; teamId: string; repositories: SidebarRepositoryTarget[]; branch?: string } | null>(null);
function openFeatureWorktreeDialog(repositories: SidebarRepositoryTarget[]): void {
  if (activeTeam.value) featureWorktreeRequest.value = { mode: 'worktree', teamId: activeTeam.value.id, repositories };
}
function openFeatureAgentDialog(repositories: SidebarRepositoryTarget[], branch?: string): void {
  if (activeTeam.value) featureWorktreeRequest.value = { mode: 'agent', teamId: activeTeam.value.id, repositories, ...(branch ? { branch } : {}) };
}
function featureWorktreeBackend(remoteConnectionId?: string): import('@workspace/core/contracts').HarnessProvider | undefined {
  return preferredProviderChoices(props.snapshot, remoteConnectionId)[0];
}
function reorderFeature(feature: { branch: string; beforeBranch: string | null }): void {
  if (activeTeam.value) void props.featureControl({ type: 'reorder', teamId: activeTeam.value.id, ...feature }).catch(() => undefined);
}
function showFeatureDialog(mode: 'rename' | 'delete', feature: { branch: string; label: string }): void {
  if (activeTeam.value) featureDialog.value = { ...feature, mode };
}
function openFeatureAgents(agentIds: string[]): void {
  activeHost.value = 'agent';
  selectedMissionId.value = null;
  split.openAgents(agentIds);
}
// A window about a team, an agent or a feature closes with it.
watch(() => [windowScope.value, windowState.teamId.value, props.snapshot.teams, props.snapshot.agents, props.snapshot.missions, props.connectionState.status] as const, ([scope, teamId, teams, agents, missions, connection]) => {
  if (!windowState.windowId.value || scope === 'workspace' || (agents.length === 0 && (scope !== 'mission' || connection !== 'connected'))) return;
  const exists = (id: string | null) => agents.some((agent) => agent.id === id);
  const gone = scope === 'mission' ? !missions?.some(mission => mission.id === windowState.missionId.value)
    : scope === 'team' ? !teams.some((team) => team.id === teamId)
    : scope === 'agent' ? !exists(windowState.agentId.value)
      : !featureAgentIds(agents, teamId, windowState.branch.value ?? '').length;
  if (gone) window.close();
});
function deleteMissionFromSidebar(id: string): void {
  if (!props.snapshot.missions?.some(candidate => candidate.id === id)) return;
  missionDeleteTargetId.value = id;
  const operation = missionDeleteOperations.get(id);
  if (operation) operation.backgrounded = false;
  missionDeleteError.value = '';
}

async function createAgentInMissionWorktree(input: { missionId: string; worktreePath: string }): Promise<void> {
  const mission = props.snapshot.missions?.find(candidate => candidate.id === input.missionId);
  const workspace = missionCreatedWorkspaces(mission).find(candidate => candidate.path === input.worktreePath);
  if (!mission || !workspace) return;
  const backend = preferredProviderChoices(props.snapshot)[0];
  if (!backend) { openSettings(); return; }
  try {
    const agent = await props.createAgent({ name: mission.outcome, folder: workspace.path, selection: { provider: backend }, teamId: mission.teamId });
    if (agent) selectAgentFromShell(agent.id);
  } catch (error) {
    ElMessage.error(localizedErrorMessage(error, t));
  }
}

function closeMissionDeleteDialog(): void {
  if (missionDeletePending.value) return;
  missionDeleteTargetId.value = null;
  missionDeleteError.value = '';
}

function backgroundMissionDeletion(): void {
  const operation = missionDeleteOperations.get(missionDeleteTargetId.value ?? '');
  if (!operation) return;
  operation.backgrounded = true;
  missionDeleteTargetId.value = null;
  missionDeleteError.value = '';
}

async function confirmMissionDeletion(deleteWorktrees: boolean): Promise<void> {
  const mission = missionDeleteTarget.value;
  if (!mission || missionDeleteOperations.has(mission.id)) return;
  const operation = { backgrounded: false };
  missionDeleteOperations.set(mission.id, operation);
  missionDeleteError.value = '';
  try {
    await props.deleteMission({ id: mission.id, revision: mission.revision, deleteWorktrees, confirmed: true });
    if (selectedMissionId.value === mission.id) {
      selectedMissionId.value = null;
      if (activeHost.value === 'mission') activeHost.value = 'agent';
    }
    if (missionDeleteTargetId.value === mission.id) missionDeleteTargetId.value = null;
    ElMessage.success(t('missions.deleted', { mission: mission.outcome }));
  } catch (error) {
    const message = localizedErrorMessage(error, t);
    if (operation.backgrounded || missionDeleteTargetId.value !== mission.id) {
      ElMessage.error(t('missions.deleteFailed', { mission: mission.outcome, message }));
    } else missionDeleteError.value = message;
  } finally {
    missionDeleteOperations.delete(mission.id);
  }
}

const fileQuickOpenVisible = ref(false);
// Files created since the agent was opened would be missing from a list loaded only then.
watch(fileQuickOpenVisible, (visible) => { if (visible) void props.loadAgentFiles?.(); });
const agentQuickOpenVisible = ref(false);
const debugApproval = ref<{ agentId: string; request: ProviderApprovalRequest } | null>(null);
const debugUserQuestions = ref<{ agentId: string; message: PaneMessage; requestId: string } | null>(null);
const debugAgentCreationProgress = ref<AgentCreationProgress | null>(null);
const debugAgentCreationTimers: Array<ReturnType<typeof setTimeout>> = [];
const agentWorkspace = ref<{
  getCommandActions(): CommandPaletteAction[];
  openRightWorkspaceTabFromMenu(agentId: string, tab: RightWorkspaceTab): void;
  focusComposer(): void;
  openSavedDraftPicker(): void;
  saveCurrentDraft(): void;
  handleBrowserOpenCommand(command: Extract<AppCommand, { type: 'open-browser' }>): void;
  openConversationImage(image: MessageImage, context?: MessageImageContext, agentId?: string): boolean;
  openConversationVisualization(visualization: ConversationVisualization, agentId?: string): void;
  showDebugGitOperationProgress(operation: 'pullRequest' | 'merge' | 'conflicts'): void | Promise<void>;
  workspaceBodyElement(): HTMLElement | null;
} | null>(null);
const settingsActiveTab = ref<SettingsTab>('general');
const agentDialogVisible = ref(false);
const modelFavoritesDialogVisible = ref(false);
const newProjectDialogVisible = ref(false);
const newProjectBusy = ref(false);
const newProjectError = ref<string | null>(null);
const modelFavoritesDialogBackend = ref<ModelFavorite['provider'] | null>(null);
const resumeSessionAgentId = ref<string | null>(null);
// IPC copies this immutable DTO; a deep Vue ref would proxy it and break serialization.
const shareTarget = shallowRef<ConversationShareTarget | null>(null);
useConversationSharePresence(() => props.snapshot.agents);
function openShare(agentId: string) {
  const agent = props.snapshot.agents.find(agent => agent.id === agentId);
  if (!agent || agent.remoteConnectionId) return;
  shareTarget.value = conversationShareTarget(agent);
}
watch(() => props.snapshot.agents.map(agent => conversationShareTarget(agent)), () => {
  if (!shareTarget.value) return;
  const agent = props.snapshot.agents.find(agent => agent.id === shareTarget.value?.agentId);
  if (!agent || JSON.stringify(conversationShareTarget(agent)) !== JSON.stringify(shareTarget.value)
    || agent.remoteConnectionId) shareTarget.value = null;
}, { deep: true });
const shareControl = (input: import('@workspace/core/conversation-sharing').ConversationShareControl) => {
  if (!appApi) return Promise.reject(new Error('Sharing is unavailable.'));
  return appApi.conversationShareControl(input);
};
const handoffAgentId = ref<string | null>(null);
const handoffAgent = computed(() => props.snapshot.agents.find(agent => agent.id === handoffAgentId.value) ?? null);
const pendingHandoffOperationId = computed(() => {
  const agent = handoffAgent.value;
  if (!agent || agent.handoff?.phase === 'failed') return undefined;
  const intent = props.snapshot.teams.find(team => team.id === agent.teamId)?.delegationHandoffs?.[agent.id];
  return intent && !intent.targetAgentId ? intent.operationId : undefined;
});
function openHandoff(agentId: string) {
  const agent = props.snapshot.agents.find(agent => agent.id === agentId);
  if (agent?.status.type === 'error' && providerSafetyBlockMessage(agent.status.message)) return;
  handoffAgentId.value = agentId;
}
async function listHandoffModels(agentId: string | null, provider: HarnessProvider) {
  return await appApi?.listProviderModels(agentId, provider) ?? [];
}
const agentDialogMode = ref<'create' | 'edit'>('create');
const editingAgentId = ref<string | null>(null);
const agentDialogTeamId = ref<string | null>(null);
const agentDialogSourceRepositoryName = ref<string | null>(null);
const agentDialogSourceBranchName = ref('');
const firstRunOnboarding = useFirstRunOnboarding({
  getApi: () => appApi,
  getConnections: () => props.snapshot.providerConnections ?? [],
  hasExistingWorkspace: () => props.snapshot.agents.length > 0 || props.snapshot.general.providerOnboardingComplete === true,
});
const {
  claudeAuthentication, claudeConnected, claudeLoading, claudeError, claudeDialogVisible,
  cursorConnected, cursorLoading, cursorPending, cursorConnectionError, connectCursor, cancelCursorLogin,
  connectionActivity,
  antigravityConnected, antigravityLoading, antigravityPending, antigravityError, connectAntigravity, cancelAntigravityLogin,
  providerSetup, customizedSetup, customizingProvider, setupBusy, updatingProvider, setupError, customizeProvider, saveProviderSetup, installProvider: installRealProvider, refreshProvider: refreshRealProvider,
  codexConnected, continuing, connectClaude, disconnectProvider, refreshClaude, continueWithProviders,
  authentication,
  authenticationCancelling,
  authenticationError,
  authenticationLoading,
  completeVisible: onboardingCompleteVisible,
  gated: realOnboardingGate,
  repositoriesVisible: repositoriesOnboardingVisible,
  initialAuthenticationLoading,
  showLogin: realLoginLanding,
  cancelChatGptLogin,
  finish: finishFirstRunOnboarding,
  load: loadAuthentication,
  startChatGptLogin,
} = firstRunOnboarding;
const telemetryNoticeReady = computed(() => {
  const existingProfile = props.snapshot.general.providerOnboardingComplete || props.snapshot.agents.length > 0;
  return existingProfile ? !initialAuthenticationLoading.value : onboardingCompleteVisible.value || !realOnboardingGate.value;
});
provide(telemetryNoticeReadyKey, telemetryNoticeReady);
// Debug previews project display state only; onboarding and live agents retain real connections.
const debugMissingEngines = ref(false);
const debugProviderUpgrades = ref(false);
provide(providerUpdatePreviewKey, debugProviderUpgrades);
const debugReviewUncommitted = ref(false);
provide(codeReviewUncommittedPreviewKey, debugReviewUncommitted);
const showOnboardingGate = computed(() => !currentAgent.value?.sharedConversation && (debugMissingEngines.value ? !settingsVisible.value : realOnboardingGate.value));
const showLoginLanding = computed(() => debugMissingEngines.value ? !settingsVisible.value : realLoginLanding.value);
const displayProviderSetup = computed(() => debugMissingEngines.value
  ? providerSetup.value.map(setup => ({ ...setup, installed: false }))
  : providerSetup.value);
const displayProviderConnections = computed(() => debugMissingEngines.value
  ? props.snapshot.providerConnections?.map(engine => ({ ...engine, installed: false, connected: false, checking: false, authentication: undefined, error: undefined }))
  : props.snapshot.providerConnections);
async function installProvider(provider: HarnessProvider): Promise<void> {
  if (!debugMissingEngines.value) await installRealProvider(provider);
}
async function refreshProvider(provider: HarnessProvider): Promise<void> {
  if (!debugMissingEngines.value) await refreshRealProvider(provider);
}
watch(() => !debugMissingEngines.value && realOnboardingGate.value, (gated) => {
  if (!appHostCapabilities.appLifecycle) return;
  void appApi?.setMenuBarVisible?.(!gated).catch((error: unknown) => {
    console.warn('Failed to update native menu visibility', error);
  });
}, { immediate: true });
const teamDialogVisible = ref(false);
const teamDialogMode = ref<'create' | 'edit'>('create');
const whatsNewVisible = ref(false);
const keyboardShortcutsVisible = ref(false);
const commandPaletteVisible = ref(false);
const editingTeamId = ref<string | null>(null);
let backlogInitialized = false;
const activeTeam = computed<Team | null>(() => {
  const selectedTeam = props.snapshot.activeTeamId
    ? props.snapshot.teams.find((team) => team.id === props.snapshot.activeTeamId) ?? null
    : null;
  if (selectedTeam) {
    return selectedTeam;
  }

  if (props.activeAgent?.teamId) {
    return props.snapshot.teams.find((team) => team.id === props.activeAgent?.teamId) ?? props.snapshot.teams[0] ?? null;
  }

  if (props.activeAgent) {
    return props.snapshot.teams.find((team) => team.agentIds.includes(props.activeAgent?.id ?? '')) ?? props.snapshot.teams[0] ?? null;
  }

  return props.snapshot.teams[0] ?? null;
});
watch([() => windowState.missionId.value, () => props.snapshot.missions], ([missionId, missions]) => {
  if (!missionWindow.value || !missionId || !missions?.some(mission => mission.id === missionId)) return;
  pendingMissionRestoreId = null;
  selectMissionSurface(missionId);
}, { immediate: true });
watch([selectedMission, activeTeam], ([mission, team], [previousMission]) => {
  if (activeHost.value === 'mission' && ((previousMission && !mission) || (!cockpitScope.value && mission && mission.teamId !== team?.id))) {
    selectedMissionId.value = null;
    activeHost.value = 'agent';
  }
});
// The Mission may reach the renderer a moment after the request, so keep the request until it is known.
const pendingMissionFocusId = ref<string | null>(null);
watch(() => props.missionFocusRequest, request => { pendingMissionFocusId.value = request?.missionId ?? null; });
watch([pendingMissionFocusId, () => props.snapshot.missions, activeTeam], () => {
  const missionId = pendingMissionFocusId.value;
  if (missionWindow.value && missionId !== windowState.missionId.value) return;
  const mission = missionId ? props.snapshot.missions?.find(candidate => candidate.id === missionId) : undefined;
  if (!mission || (!cockpitScope.value && mission.teamId !== activeTeam.value?.id)) return;
  pendingMissionFocusId.value = null;
  selectMissionSurface(mission.id);
});
watch(() => props.connectionState.status, (status) => {
  if (missionWindow.value || status !== 'connected' || !pendingMissionRestoreId) return;
  const missionId = pendingMissionRestoreId;
  pendingMissionRestoreId = null;
  const mission = props.snapshot.missions?.find(candidate => candidate.id === missionId);
  if (mission?.teamId === activeTeam.value?.id) selectMissionSurface(missionId);
  else rememberMissionId(null);
}, { immediate: true });
const workItemRouting = useWorkItemRouting({
  actions: {
    assign: (payload) => props.assignWorkItemAction(payload),
    assignFromUi: (payload) => emit('assign-work-item', payload),
    createAgent: (input) => props.createAgent(input),
    createBranch: (agentId, input) => props.createAgentGitBranch(agentId, input),
    createWorktree: (input) => props.createSourceWorktree(input),
    listBranches: (repoPath, remoteConnectionId) => props.listSourceBranches(repoPath, remoteConnectionId),
    listSourceRepositories: (remoteConnectionId) => props.listSourceRepositories(remoteConnectionId),
    cloneRepository: (input) => props.cloneSourceRepository(input),
    duplicateAgent: (agentId, options) => props.duplicateAgentAction(agentId, options),
    loadItems: (provider, repositoryId, query) => props.loadWorkItems(provider, repositoryId, undefined, query),
  },
  model: {
    activeTeamId: () => activeTeam.value?.id ?? props.snapshot.activeTeamId ?? undefined,
    composerText: () => props.composerState.text,
    currentAgent: () => currentAgent.value,
    snapshot: () => props.snapshot,
    sourceRepositories: () => props.sourceRepositories,
  },
  ui: {
    notifyError: (message) => ElMessage.error(message),
    confirmReassignment: async (message) => {
      try {
        await ElMessageBox.confirm(
          message,
          translate('surface.appShell.assignAnyway'),
          {
            cancelButtonText: translate('common.cancel'),
            confirmButtonText: translate('dynamic.misc.assignAnyway'),
            type: 'warning',
          },
        );
        return true;
      } catch {
        return false;
      }
    },
    focusComposer: () => {
      void nextTick(() => focusedConversationPanel()?.focusComposer());
    },
    openNewAgent: (teamId, repositoryName) => openNewAgent(teamId, repositoryName),
    selectAgent: selectAgentFromShell,
    updateComposer: (agentId, text) => emit('update:composerState', {
      agentId,
      state: {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    }),
  },
});
const {
  assignCreatedAgent: assignPendingWorkItemToCreatedAgent,
  assignExisting: assignExistingAgentWorkItem,
  clearNewAgent: clearPendingNewAgentWorkItem,
  createIsolatedAgent: createIsolatedWorkItemAgent,
  creationProgress: workItemCreationProgress,
  closeCreationProgress: closeWorkItemCreationProgress,
  backgroundCreationProgress: backgroundWorkItemCreationProgress,
  newAgentItem: pendingNewAgentWorkItem,
  newAgentTeamName: pendingNewAgentTeamName,
  newAgentWorktreeBranchName: pendingWorkItemBranchName,
  openNewAgent: openNewAgentForWorkItem,
  prefill: prefillWorkItemForAgent,
  startInExistingSession: startWorkItemInExistingSession,
  startMany: startCockpitWorkItems,
  startRepositoryWork,
} = workItemRouting;
const repositorySession = useRepositorySession({
  activeTeamId: () => activeTeam.value?.id ?? undefined,
  assignWorkItem: (payload) => props.assignWorkItemAction(payload),
  createAgent: (input, navigation) => navigation ? props.createAgent(input, navigation) : props.createAgent(input),
  createIsolatedWorkItemAgent,
  createSourceWorktree: (input) => props.createSourceWorktree(input),
  cloneRepository: (input) => props.cloneSourceRepository(input),
  remoteConnections: () => props.snapshot.remoteConnections.connections,
  getAgentGitRemote: async (agentId) => (await props.getAgentGitWorkflow(agentId, { includePullRequest: false })).remoteUrl,
  getSnapshot: () => props.snapshot,
  getWorkRepositories: (provider) => props.workRepositoriesByProvider[provider] ?? [],
  listSourceRepositories: (remoteConnectionId) => props.listSourceRepositories(remoteConnectionId),
  listSourceBranches: (repoPath, remoteConnectionId) => props.listSourceBranches(repoPath, remoteConnectionId),
  loadWorkItems: async (repositoryId, location, provider = 'github') => await props.loadWorkItems(
    provider,
    repositoryId,
    location,
    { kind: 'all', state: 'open' },
  ) ?? [],
  loadWorkRepositories: async (location, provider = 'github') => await props.loadWorkRepositories(provider, location),
  notifyError: (message) => ElMessage.error(message),
  prefillWorkItemForAgent,
  startWorkItemInExistingSession,
  suggestSourceWorktreePath: (input) => props.suggestSourceWorktreePath(input),
});
const {
  assignmentSessions: repositorySessionAssignmentSessions,
  branches: repositorySessionSourceBranches,
  close: closeRepositorySessionSource,
  closeWorktree: closeRepositorySessionWorktree,
  closeCreationProgress: closeRepositorySessionCreationProgress,
  backgroundCreationProgress: backgroundRepositorySessionCreationProgress,
  creationProgress: repositorySessionCreationProgress,
  createForSourceBranch: openNewAgentForSourceBranch,
  createFromWorktree: createRepositorySessionFromWorktree,
  createOnBranch: createRepositorySessionOnBranch,
  createWorktree: createRepositorySessionWorktree,
  customizeWork: customizeRepositorySessionWork,
  error: repositorySessionSourceError,
  listBranches: listRepositorySessionBranches,
  loading: repositorySessionSourceLoading,
  open: openRepositorySessionSource,
  openWorktree: openRepositorySessionWorktree,
  source: repositorySessionSource,
  startWork: startRepositorySessionWork,
  suggestWorktreePath: suggestRepositorySessionWorktreePath,
  visible: repositorySessionSourceVisible,
  workItems: repositorySessionSourceWorkItems,
  worktreeBranches: repositorySessionWorktreeBranches,
  worktreeBranchesLoading: repositorySessionWorktreeBranchesLoading,
  worktreeRepository: repositorySessionWorktreeRepository,
  worktreeSource: repositorySessionWorktreeSource,
} = repositorySession;
const remoteTarget = useRemoteTarget({
  connections: () => props.snapshot.remoteConnections.connections,
  listSourceRepositories: (remoteConnectionId) => props.listSourceRepositories(remoteConnectionId),
  cloneRepository: (input) => props.cloneSourceRepository(input),
  errorMessage: (error) => localizedErrorMessage(error, t),
  openMain: async (path, remoteConnectionId, request, selection) => {
    const backend = selection?.provider ?? preferredProviderChoices(props.snapshot, remoteConnectionId)[0];
    try {
      if (!backend) throw new Error(t('remoteTarget.noEngine'));
      await props.createAgent({
        name: null,
        folder: path,
        repositorySession: {},
        selection: selection ?? { provider: backend },
        sourceRepositoryName: request.repositoryName,
        remoteConnectionId,
        ...(activeTeam.value ? { teamId: activeTeam.value.id } : {}),
      });
    } catch (error) {
      ElMessage.error(localizedErrorMessage(error, t));
    }
  },
  openWorktree: (path, remoteConnectionId, request) => openRepositorySessionWorktree({
    repositoryName: request.repositoryName,
    repositoryRoot: path,
    remoteConnectionId,
    ...(activeTeam.value ? { teamId: activeTeam.value.id } : {}),
  }),
});
function openOnRemote(request: RemoteTargetRequest): void {
  void remoteTarget.open(request);
}
const repositoryAcquisition = useRepositoryAcquisition({
  notifySuccess: message => { ElMessage.success(message); },
  notifyError: message => { ElMessage.error(message); },
  activeTeamId: () => props.snapshot.activeTeamId ?? undefined,
  catalog: provider => props.workRepositoriesByProvider[provider],
  chooseLocalFolder: () => props.chooseAgentFolder(),
  chooseSourceFolder: () => props.chooseSourceFolder(),
  sourceFolder: () => props.snapshot.sourceFolder.path,
  saveSourceFolder: path => props.updateSettings({ sourceFolder: { path } }),
  cloneRepository: (input) => props.cloneSourceRepository(input),
  connectProvider: provider => props.connectWorkProvider(provider),
  errorMessage: (error) => localizedErrorMessage(error, t),
  connection: provider => props.snapshot.workBacklog.connections.find(item => item.provider === provider) ?? { provider, status: 'disconnected' },
  connectionError: provider => {
    const connection = props.snapshot.workBacklog.connections.find(item => item.provider === provider);
    return connection?.detail ? localizedText(connection.detail, t) : null;
  },
  loadRepositories: (provider) => props.listWorkSources ? props.listWorkSources(provider) : props.loadWorkRepositories(provider),
  openFolder: async (folder, teamId) => {
    const backend = preferredProviderChoices(props.snapshot)[0];
    if (!backend) { openSettings(); return; }
    await props.createAgent({
      name: null,
      folder,
      selection: { provider: backend },
      ...(teamId ? { teamId } : {}),
    });
  },
  openAuthorization: provider => props.openWorkProviderAuthorization(provider),
  openRepository: (repository, teamId, workSource) => openRepositorySessionSource({
    teamId,
    workSource,
    repositoryName: repository.name,
    repositoryRoot: repository.path,
  }),
  sourceRepositories: () => props.sourceRepositories,
});
const {
  busy: repositoryAcquireBusy,
  catalogLoading: repositoryAcquireCatalogLoading,
  cloneAndOpen: cloneRepositoryAndOpen,
  close: closeRepositoryAcquire,
  connect: connectGitHub,
  displayError: repositoryAcquireDisplayError,
  error: repositoryAcquireError,
  mode: repositoryAcquireMode,
  open: openRepositoryAcquire,
  openAuthorization: openGitHubAuthorization,
  openExistingFolder: openExistingRepositoryFolder,
  repositories: repositoryAcquireRepositories,
  select: selectWorkRepository,
  sourceRepositories: repositoryAcquireSourceRepositories,
  visible: repositoryAcquireVisible,
} = repositoryAcquisition;
const activeTeamAgents = computed(() => {
  const team = activeTeam.value;
  if (!team) {
    return [];
  }

  return team.agentIds
    .map((agentId) => props.snapshot.agents.find((agent) => agent.id === agentId))
    .filter((agent): agent is Agent => Boolean(agent));
});
const missionOwnedAgentIds = computed(() => new Set((props.snapshot.missions ?? []).flatMap(missionAgentIds)));
const quickOpenAgents = computed(() => props.snapshot.agents.filter(agent => {
  if (missionWindow.value) return selectedMission.value ? missionAgentIds(selectedMission.value).includes(agent.id) : false;
  if (missionOwnedAgentIds.value.has(agent.id)) return false;
  if (windowScope.value === 'feature') return featureAgents.value.includes(agent.id);
  if (windowScope.value === 'team') return props.snapshot.teams.find(team => team.id === windowState.teamId.value)?.agentIds.includes(agent.id) === true;
  if (windowScope.value === 'agent') return agent.id === windowState.agentId.value;
  return true;
}));
const quickOpenMissions = computed(() => {
  const missions = props.snapshot.missions ?? [];
  if (missionWindow.value) return missions.filter(mission => mission.id === windowState.missionId.value);
  if (windowScope.value === 'workspace') return missions;
  if (windowScope.value === 'team') return missions.filter(mission => mission.teamId === windowState.teamId.value);
  return [];
});
const workspaceAgents = computed(() => (cockpitScope.value ? props.snapshot.agents : activeTeamAgents.value)
  .filter(agent => !missionOwnedAgentIds.value.has(agent.id)));
const agentMentionGroups = computed<readonly ComposerMentionGroup[]>(() => projectAgentMentionGroups({
  agents: activeTeamAgents.value,
  missions: (props.snapshot.missions ?? []).filter(mission => mission.teamId === activeTeam.value?.id),
  activeMissionId: activeHost.value === 'mission' ? selectedMissionId.value : null,
  agentsLabel: translate('surface.appShell.agents'),
  missionLabel: t('chat.composerActions.mission'),
  quickChatsLabel: t('sidebar.quickChats'),
  leadLabel: t('missions.missionLead'),
  builderLabel: t('missions.builder'),
}));
const unreadTeamIds = computed(() => {
  const unreadAgentIdSet = new Set(navigationUnreadAgentIds(props.snapshot.missions ?? [], props.unreadAgentIds ?? []));
  return props.snapshot.teams
    .filter((team) => (
      (activeHost.value !== 'agent' || cockpitScope.value || team.id !== activeTeam.value?.id)
      && team.agentIds.some((agentId) => unreadAgentIdSet.has(agentId))
    ))
    .map((team) => team.id);
});
const workingTeamIds = computed(() => {
  const workingAgentIds = new Set(props.snapshot.agents
    .filter((agent) => agent.status.type === 'working')
    .map((agent) => agent.id));
  return props.snapshot.teams
    .filter((team) => team.agentIds.some((agentId) => workingAgentIds.has(agentId)))
    .map((team) => team.id);
});
const forkableAgentIds = computed(() => props.snapshot.agents
  .filter((agent) => {
    const defaults = defaultProviderCapabilities(agent.provider);
    const runtime = props.snapshot.providerRuntimes.find((candidate) => candidate.provider === agent.provider);
    return (runtime?.capabilities?.conversationFork ?? defaults.conversationFork) === true;
  })
  .map((agent) => agent.id));
const summaryReplacementAgentIds = computed(() => props.snapshot.agents
  .filter((agent) => {
    const runtime = props.snapshot.providerRuntimes.find((candidate) => candidate.provider === agent.provider);
    return (runtime?.capabilities?.scopedExecution ?? defaultProviderCapabilities(agent.provider).scopedExecution) === true;
  }).map((agent) => agent.id));
const currentAgent = computed(() => {
  const team = activeTeam.value;
  if (!team) {
    return null;
  }
  if (missionWindow.value) {
    const ids = selectedMission.value ? missionAgentIds(selectedMission.value) : [];
    return activeTeamAgents.value.find(agent => ids.includes(agent.id) && agent.id === props.activeAgent?.id)
      ?? activeTeamAgents.value.find(agent => ids.includes(agent.id)) ?? null;
  }

  if (activeHost.value !== 'mission' && cockpitScope.value) {
    return workspaceAgents.value.find(agent => agent.id === props.activeAgent?.id) ?? workspaceAgents.value[0] ?? null;
  }

  if (props.activeAgent && team.agentIds.includes(props.activeAgent.id)) {
    return props.activeAgent;
  }

  return activeTeamAgents.value.find((agent) => agent.id === team.activeAgentId) ?? activeTeamAgents.value[0] ?? null;
});
// The window title is what the Window menu lists, so each window is named for what it shows.
const windowTitle = computed(() => {
  const agentName = currentAgent.value ? agentDisplayName(currentAgent.value) : null;
  const teamName = activeTeam.value?.name;
  if (windowScope.value === 'agent') return agentName ?? product.name;
  if (windowScope.value === 'team') return teamName ?? product.name;
  if (missionWindow.value) return selectedMission.value ? `${selectedMission.value.outcome} · ${teamName ?? product.name}` : product.name;
  if (windowScope.value === 'feature') {
    const feature = featureLabel(activeTeam.value?.featureLabels, windowState.branch.value ?? '');
    return teamName ? `${feature} · ${teamName}` : feature || product.name;
  }
  return agentName && teamName ? `${agentName} · ${teamName}` : product.name;
});
watch(windowTitle, (title) => { document.title = title; }, { immediate: true });
watch(
  [compactViewport, activeHost],
  ([compact, surface]) => {
    if (compact && surface !== 'agent' && !missionWindow.value) activeHost.value = 'agent';
  },
  { immediate: true },
);
// Getter-per-source: a getter returning a fresh array would fire on every snapshot update.
watch(
  [compactViewport, () => currentAgent.value?.id, activeHost, selectedMissionId],
  ([compact]) => { if (!compact || compactNavOpen.value) compactNavOpen.value = false; },
);
watch(() => currentAgent.value?.id, (agentId) => {
  if (pendingReviewClarification.value && pendingReviewClarification.value.agentId !== agentId) {
    pendingReviewClarification.value = null;
  }
});
const split = useSplitWorkspace({
  agentIds: () => chromeless.value ? [currentAgent.value?.id].filter((id): id is string => Boolean(id)) : featureWindow.value ? featureAgents.value : (cockpitScope.value ? workspaceAgents.value : activeTeamAgents.value).map(agent => agent.id),
  currentAgentId: () => cockpitScope.value && activeHost.value === 'mission' ? undefined : currentAgent.value?.id,
  teamId: () => cockpitScope.value ? 'surface:cockpit' : activeTeam.value?.id,
  selectAgent: id => emit('select-agent', id),
  persist: () => !featureWindow.value && !chromeless.value,
});
// Compact screens display one conversation without changing the saved team layout.
const splitLayout = computed(() => compactViewport.value || chromeless.value ? 'single' : split.layout.value);
const hasFocusedConversation = computed(() => compactViewport.value || Boolean(split.focusedPane.value.agentId));
const rightWorkspaceState = useRightWorkspaceState({
  currentAgentId: () => currentAgent.value?.id,
  sharedVisibilityGroupId: () => splitLayout.value === 'single' ? undefined : activeTeam.value?.id,
  workspaceBody: () => agentWorkspace.value?.workspaceBodyElement() ?? null,
});
const documentWorkspaces = useDocumentWorkspaces({
  api: appApi,
  workspaces: rightWorkspaceState.workspaces,
  canUseWorkspace: agentId => !props.snapshot.agents.find(agent => agent.id === agentId)?.sharedConversation,
  agentExists: agentId => props.snapshot.agents.some(agent => agent.id === agentId),
  workspaceFor: rightWorkspaceState.workspaceFor,
  reportError: message => ElMessage.error(message),
});
const saveDocumentAs = useDocumentSaveAs({
  snapshot: () => props.snapshot,
  workspaceFor: rightWorkspaceState.workspaceFor,
  save: documentWorkspaces.save,
});
provideConversationAnnotationDrafts();
const conversationAnnotationVisible = ref(false);
const conversationPanes = computed(() => compactViewport.value || chromeless.value
  ? [{ id: split.focusedPane.value.id, agentId: currentAgent.value?.id ?? null }]
  : split.panes.value);
function conversationViewFor(agentId: string): AgentConversationView | null {
  const view = props.agentConversationFor?.(agentId);
  if (view) return view;
  const agent = currentAgent.value;
  if (!agent || agent.id !== agentId) return null;
  return {
    agent, conversation: props.conversationPresentation ?? null,
    composerState: props.composerState, attachments: props.composerAttachments,
    capabilities: props.providerCapabilities, approvals: props.approvals, queuedPrompts: props.queuedPrompts.map(prompt => ({ ...prompt, agentId, text: prompt.text, createdAt: '' })),
    sending: props.isSending, answeredClientRequestIds: props.answeredClientRequestIds,
    history: { failed: props.isConversationLoadFailed, hydrating: props.isConversationLoading || props.isLoading,
      hasOlder: props.historyHasOlder, loadingOlder: props.historyLoadingOlder },
    composer: {
      provider: agent.provider, selectionSource: '', models: props.providerModels, modelStatus: props.modelCatalogStatus,
      modelError: null, skills: props.providerSkills, plugins: props.providerPlugins, skillStatus: props.skillCatalogStatus,
      skillError: null, files: props.agentFiles, fileStatus: 'loaded', fileError: null,
      selectedModelId: props.selectedModelId, selectedReasoningEffort: props.selectedReasoningEffort,
      selectedServiceTier: props.selectedServiceTier, planMode: props.planMode, pendingSelection: null,
    },
  };
}
const legacyConversationActions: AgentConversationActions = {
  prepare: () => undefined, retryHistory: () => props.retryAgentHistory?.(),
  planReview: (id, resolution) => { if (resolution !== 'cancel') emit('update:planMode', resolution === 'revise'); },
  clearGoal: () => emit('clear-goal'), threadFlag: (_id, response) => props.respondToThreadFlagAction?.(response),
  loadOlder: id => props.loadOlderAgentHistory?.(id), loadTurn: async (id, turn) => { await props.loadAgentTurnHistory?.(id, turn); },
  requestSkills: id => props.agentConversationActions?.requestSkills?.(id),
  send: (_id, text, options) => props.sendPromptAction ? props.sendPromptAction(text, options) : options ? emit('sendPrompt', text, options) : emit('sendPrompt', text),
  steer: (_id, text, options) => forwardSteerPrompt(text, options), interrupt: () => emit('interrupt-agent'),
  deleteTurn: (_id, turn) => props.deleteTurnAction ? props.deleteTurnAction(turn) : emit('delete-turn', turn),
  editTurn: (_id, payload) => props.editTurnAction ? props.editTurnAction(payload) : emit('edit-turn', payload),
  forkTurn: (_id, turn) => emit('fork-turn', turn), retryTurn: (_id, turn) => props.retryTurnAction ? props.retryTurnAction(turn) : emit('retry-turn', turn),
  continueInterruptedTurn: () => props.continueInterruptedTurnAction?.(),
  respond: (_id, response) => emit('agent-response', response),
  selectModel: (_id, model) => emit('select-model', model), selectReasoningEffort: (_id, effort) => emit('select-reasoning-effort', effort),
  selectServiceTier: (_id, tier) => emit('select-service-tier', tier), setPlanMode: (_id, enabled) => emit('update:planMode', enabled),
  setPermissionMode: (_id, mode) => emit('select-permission-mode', mode),
  updateComposerState: (agentId, state) => emit('update:composerState', { agentId, state }),
  updateAttachments: (agentId, attachments) => emit('update:composerAttachments', { agentId, attachments }),
  deleteQueuedPrompt: (_id, prompt) => emit('delete-queued-prompt', prompt),
  updateQueuedPrompt: (_id, prompt, text, options) => options ? emit('update-queued-prompt', prompt, text, options) : emit('update-queued-prompt', prompt, text),
  steerQueuedPrompt: (_id, prompt, text, options) => options ? emit('steer-queued-prompt', prompt, text, options) : emit('steer-queued-prompt', prompt, text),
};
const conversationPanels = new Map<string, InstanceType<typeof AgentConversationPanel>>();
const visibilityObserver = new MutationObserver(syncVisibleAgents);
let visibilityDisposed = false;
let reportedVisibleAgents = '';
function setConversationPanel(agentId: string, instance: unknown): void {
  if (conversationPanels.get(agentId) === instance) return;
  if (instance) conversationPanels.set(agentId, instance as InstanceType<typeof AgentConversationPanel>);
  else conversationPanels.delete(agentId);
  observeConversationVisibility();
  void nextTick(observeConversationVisibility);
}
function isAgentVisible(agentId: string): boolean {
  if (document.visibilityState !== 'visible' || showOnboardingGate.value || showLoginLanding.value) return false;
  const root = conversationPanels.get(agentId)?.getElement?.();
  if (!(root instanceof HTMLElement) || !root.isConnected) return false;
  // Mounted Mission conversations can be hidden by an expanded workbench.
  for (let element: HTMLElement | null = root; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function syncVisibleAgents(): void {
  if (visibilityDisposed) return;
  const agentIds = [...conversationPanels.keys()].filter(isAgentVisible).sort();
  const signature = JSON.stringify(agentIds);
  if (signature === reportedVisibleAgents) return;
  reportedVisibleAgents = signature;
  emit('visible-agents-change', agentIds);
}
function observeConversationVisibility(): void {
  if (visibilityDisposed) return;
  visibilityObserver.disconnect();
  for (const panel of conversationPanels.values()) {
    for (let element = panel.getElement?.() ?? null; element; element = element.parentElement) {
      visibilityObserver.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
  }
  syncVisibleAgents();
}
watch([showOnboardingGate, showLoginLanding], syncVisibleAgents, { flush: 'post' });
onMounted(() => {
  observeConversationVisibility();
  document.addEventListener('visibilitychange', syncVisibleAgents);
  window.addEventListener('resize', syncVisibleAgents);
});
onBeforeUnmount(() => {
  visibilityDisposed = true;
  visibilityObserver.disconnect();
  document.removeEventListener('visibilitychange', syncVisibleAgents);
  window.removeEventListener('resize', syncVisibleAgents);
  emit('visible-agents-change', []);
});
function focusedConversationPanel() {
  return conversationPanels.get((activeHost.value === 'mission' || splitLayout.value === 'single' ? currentAgent.value?.id : split.focusedPane.value.agentId) ?? '');
}
const pendingComposerFocusAgentId = ref<string | null>(null);
// A cold conversation has no composer until history hydration replaces its loader.
// Only navigation requests focus; clicking a split-pane control keeps its focus.
function focusSplitPane(paneId: number): void {
  pendingComposerFocusAgentId.value = null;
  split.focus(paneId);
}
watch([
  pendingComposerFocusAgentId,
  () => currentAgent.value?.id,
  () => {
    const id = pendingComposerFocusAgentId.value;
    const view = id ? props.agentConversationFor?.(id) : null;
    return view
      ? view.history.hydrating || conversationForView(view)?.historyLoading
      : props.isConversationLoading;
  },
], ([requestedId, activeId, loading]) => {
  if (!requestedId || requestedId !== activeId || loading) return;
  void nextTick(() => {
    if (pendingComposerFocusAgentId.value !== requestedId || currentAgent.value?.id !== requestedId) return;
    pendingComposerFocusAgentId.value = null;
    if (activeHost.value === 'agent' && !isModalDialogVisible.value) focusedConversationPanel()?.focusComposer();
  });
}, { flush: 'post' });
function addFocusedCodeAnnotation(annotation: import('./use-code-annotations').CodeAnnotationInput): void {
  conversationPanels.get(currentAgent.value?.id ?? '')?.addCodeAnnotation(annotation);
}
function addFocusedVisualizationAnnotation(annotation: import('./use-visualization-annotations').VisualizationAnnotationInput): void {
  conversationPanels.get(currentAgent.value?.id ?? '')?.addVisualizationAnnotation(annotation);
}
const conversationActions = computed<AgentConversationActions>(() => ({
  ...(props.agentConversationActions ?? legacyConversationActions),
  respond: (id, response) => {
    if (debugApproval.value?.request.id === response.id) { debugApproval.value = null; return; }
    if (debugUserQuestions.value?.requestId === response.id) { debugUserQuestions.value = null; return; }
    return (props.agentConversationActions ?? legacyConversationActions).respond(id, response);
  },
  send: async (agentId, prompt, options) => {
    await backendSwitch.settled();
    const design = prompt.match(/^\/design(?:\s+([\s\S]*))?$/u);
    if (design) return startDesignForAgent(agentId, design[1]?.trim(), options?.attachments);
    const visualize = prompt.match(/^\/visualize(?:\s+([\s\S]*))?$/u);
    if (visualize && !options?.attachments?.length) {
      return startVisualizeForAgent(agentId, visualize[1]?.trim() ? { prompt: visualize[1].trim() } : { choose: true });
    }
    const review = prompt.trim().match(/^\/review(?:\s+([\s\S]*))?$/u);
    if (review && !options?.attachments?.length) return openCodeReviewForAgent(agentId, review[1]?.trim());
    const clarification = pendingReviewClarification.value;
    if (clarification?.agentId === agentId && !options?.attachments?.length) {
      await props.discussCodeReviewFinding(agentId, { sessionId: clarification.sessionId, roundId: clarification.roundId, findingId: clarification.findingId, question: prompt });
      if (pendingReviewClarification.value === clarification) pendingReviewClarification.value = null;
      return;
    }
    return (props.agentConversationActions ?? legacyConversationActions).send(agentId, prompt, options);
  },
}));
function openConversationLink(agentId: string, link: ConversationLink): void | Promise<void> {
  if (link.kind === 'external') return appPlatformActions.openExternal?.(link.href);
  if (activeHost.value === 'mission') missionPreviewAgentId.value = agentId;
  return workspacePreviews.openConversationFile({ ...link, kind: 'file' }, agentId, activeHost.value !== 'mission');
}
const {
  closeTab: closeRightWorkspaceTabLocal,
  isVisible: isRightWorkspaceVisible,
  openTab: openRightWorkspaceTabLocal,
  rightWorkspaceVisible,
  resizing: rightWorkspaceResizing,
  selectTab: selectRightWorkspaceTab,
  startResize: startRightWorkspaceResize,
  toggle: toggleRightWorkspaceLocal,
  toggleFiles: toggleFileExplorer,
  workspaceFor: rightWorkspaceFor,
  workspaces: rightWorkspaces,
} = rightWorkspaceState;
// The panes a window opens with come from the window it was opened from (or from its last run); from then on they are its own.
// Main keeps what each window reports, so a new window, a relaunch and a Browser moved here can all start from it.
const stopFollowingSetup = windowState.onSetup((setup, mode) => {
  for (const [agentId, pane] of Object.entries(setup)) {
    if (props.snapshot.agents.some(agent => agent.id === agentId)) applyAgentSetup(rightWorkspaceState.workspaceFor(agentId), pane, mode);
  }
});
onBeforeUnmount(stopFollowingSetup);
const workspaceSetup = computed(() => exportWorkspaceSetup(rightWorkspaces));
let reportedSetup = '{}';
let reportSetupTimer: ReturnType<typeof setTimeout> | undefined;
watch(workspaceSetup, (setup) => {
  clearTimeout(reportSetupTimer);
  reportSetupTimer = setTimeout(() => {
    const key = JSON.stringify(setup);
    if (key === reportedSetup) return;
    reportedSetup = key;
    void appApi?.setWindowSetup?.(JSON.parse(key)).catch(() => undefined);
  }, 300);
});
onBeforeUnmount(() => clearTimeout(reportSetupTimer));


const missionPreviewAgentId = ref<string | null>(null);
const missionWorkspaceVisible = computed(() => {
  const id = missionPreviewAgentId.value ?? currentAgent.value?.id;
  return Boolean(id && selectedMission.value && missionAgentIds(selectedMission.value).includes(id) && rightWorkspaceFor(id).open);
});
function isPresentedWorkspaceVisible(agentId: string): boolean {
  return activeHost.value === 'mission'
    ? missionWorkspaceVisible.value && agentId === (missionPreviewAgentId.value ?? currentAgent.value?.id)
    : isRightWorkspaceVisible(agentId);
}
function toggleRightWorkspace(): void {
  const id = missionPreviewAgentId.value ?? currentAgent.value?.id;
  if (activeHost.value === 'mission' && missionWorkspaceVisible.value && id) rightWorkspaceFor(id).open = false;
  else {
    missionPreviewAgentId.value = currentAgent.value?.id ?? null;
    toggleRightWorkspaceLocal();
  }
}
function closeWorkspacePreview(): void {
  const id = missionPreviewAgentId.value ?? currentAgent.value?.id;
  if (id) rightWorkspaceFor(id).open = false;
}
function openRightWorkspaceTab(tab: RightWorkspaceTab, agentId = currentAgent.value?.id): void {
  if (activeHost.value === 'mission' && agentId) missionPreviewAgentId.value = agentId;
  openRightWorkspaceTabLocal(tab, agentId);
}

async function openCodeReviewForAgent(agentId: string, instructions?: string): Promise<void> {
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId);
  if (instructions && agent?.codeReview) {
    throw new Error(t('surface.codeReviewPanel.instructionsRequireNewReview'));
  }
  if (agent?.threadFlags?.ready_for_review) {
    const response: ThreadFlagResponse = { id: 'ready_for_review', action: 'execute' };
    if (props.agentConversationActions) await props.agentConversationActions.threadFlag(agentId, response);
    else if (currentAgent.value?.id === agentId) await props.respondToThreadFlagAction?.(response);
  }
  rightWorkspaceFor(agentId).codeReviewInstructions = instructions?.trim() || undefined;
  openRightWorkspaceTab('codeReview', agentId);
}

async function startDesignForAgent(agentId: string, prompt?: string, attachments?: RendererSendPromptOptions['attachments']): Promise<void> {
  if (!appApi) throw new Error('Design is unavailable.');
  await appApi.design(agentId, { type: 'open', ...(prompt ? { prompt } : {}), ...(attachments?.length ? { attachments } : {}) });
  openRightWorkspaceTab('design', agentId);
}

async function startVisualizeForAgent(agentId: string, input?: import('@workspace/core/visualize').StartVisualizeInput): Promise<void> {
  const alreadyOpen = rightWorkspaceFor(agentId).tabs.includes('visualize');
  openRightWorkspaceTab('visualize', agentId);
  try {
    await props.startVisualize(agentId, input);
  } catch (error) {
    if (!alreadyOpen) closeRightWorkspaceTabLocal(agentId, 'visualize');
    throw error;
  }
}

function closeRightWorkspaceTab(agentId: string, tab: RightWorkspaceTab): void {
  documentWorkspaces.recordClose(agentId, tab);
  closeRightWorkspaceTabLocal(agentId, tab);
  if (tab === 'design') void appApi?.design(agentId, { type: 'close' }).catch(error => { openRightWorkspaceTabLocal('design', agentId); ElMessage.error(localizedErrorMessage(error, t)); });
  const visualize = props.snapshot.agents.find(agent => agent.id === agentId)?.visualize;
  if (tab === 'visualize' && visualize?.isOpen) {
    void props.setVisualizeOpen(agentId, { open: false }).catch(error => {
      openRightWorkspaceTabLocal('visualize', agentId);
      ElMessage.error(localizedErrorMessage(error, t));
    });
  }
}

watch(
  () => props.snapshot.agents.map(agent => ({ agentId: agent.id, design: agent.designWorkspace })),
  entries => {
    for (const { agentId, design } of entries) {
      const workspace = rightWorkspaceFor(agentId);
      if (design?.isOpen && !workspace.tabs.includes('design')) openRightWorkspaceTabLocal('design', agentId);
      else if (design && !design.isOpen && workspace.tabs.includes('design')) closeRightWorkspaceTabLocal(agentId, 'design');
    }
  }, { immediate: true, flush: 'sync' },
);
// A removed agent takes its Design history with it; the first snapshot also clears what was left by agents removed while the app was closed.
let sweptDesignHistory = false;
watch(
  () => props.snapshot.agents.map(agent => agent.id),
  (agentIds, previous) => {
    if (!agentIds.length) return;
    const live = new Set(agentIds);
    if (!sweptDesignHistory) { sweptDesignHistory = true; pruneDesignHistory(live); return; }
    for (const agentId of previous ?? []) if (!live.has(agentId)) forgetDesignHistory(agentId);
  }, { immediate: true },
);
watch(
  () => props.snapshot.agents.map(agent => ({ agentId: agent.id, visualize: agent.visualize })),
  entries => {
    for (const entry of entries) {
      const workspace = rightWorkspaceFor(entry.agentId);
      if (entry.visualize?.isOpen && !workspace.tabs.includes('visualize')) {
        openRightWorkspaceTabLocal('visualize', entry.agentId);
      } else if (!entry.visualize?.isOpen && workspace.tabs.includes('visualize')) {
        closeRightWorkspaceTabLocal(entry.agentId, 'visualize');
      }
    }
  },
  { immediate: true, flush: 'sync' },
);
const missionDocuments = useMissionDocuments({
  missions: () => props.snapshot.missions ?? [],
  agents: () => props.snapshot.agents,
  activeMissionId: () => activeHost.value === 'mission' ? selectedMissionId.value : null,
  currentAgentId: () => currentAgent.value?.id,
  open: request => openMarkdownRequest(request),
});
const conversationFileActions = useConversationFileActions({
  agent: id => props.snapshot.agents.find(agent => agent.id === id),
  download: downloadAgentFile,
  reportError: message => { ElMessage.error(message); },
});
const workspacePreviews = useWorkspacePreviews({
  readConversationContent: (agentId, input) => appApi ? appApi.readConversationContent(agentId, input) : Promise.reject(new Error('Conversation content unavailable.')),
  downloadAgentFile,
  ...(conversationFileActions.nativeAvailable() ? { openLocalFile: conversationFileActions.openNative } : {}),
  reportError: message => { ElMessage.error(message); },
  closeTab: closeRightWorkspaceTab,
  currentAgent: () => currentAgent.value,
  getSnapshot: () => props.snapshot,
  getAgentGitDiff: (agentId, target) => target
    ? props.getAgentGitDiff(agentId, target)
    : props.getAgentGitDiff(agentId),
  openTab: openRightWorkspaceTab,
  previewAgentFile: (agentId, filePath) => props.previewAgentFile(agentId, filePath),
  workspaceFor: rightWorkspaceFor,
});
// Restored tabs retain references, so load the diff when its workspace becomes visible.
watch(
  () => Object.entries(rightWorkspaces).find(([agentId, workspace]) => workspace.activeTab === 'review'
    && !workspace.gitReviewPanel && isPresentedWorkspaceVisible(agentId)
    && props.snapshot.agents.some(agent => agent.id === agentId && agent.folder))?.[0],
  agentId => { if (agentId) void workspacePreviews.openAgentGitDiff(agentId); },
  { immediate: true },
);
const {
  handleFileActivity,
  openAgentGitDiff: openAgentGitDiffForAgent,
  openMarkdown: openMarkdownRequest,
  openSidePanel: openSidePanelRequest,
} = workspacePreviews;
function openFilePreviewForAgent(agentId: string, path: string): Promise<void> {
  if (activeHost.value === 'mission') missionPreviewAgentId.value = agentId;
  return workspacePreviews.openFile(agentId, path);
}
function openAgentGitDiffPreview(agentId = currentAgent.value?.id, target?: import('@workspace/core/contracts').AgentGitDiffTarget, focusKind?: import('@workspace/core/file-kind').FileKind): Promise<void> {
  return agentId ? openAgentGitDiffForAgent(agentId, target, focusKind) : Promise.resolve();
}
function openDebugImageAnnotation(imageDataUrl?: string, pixelRatio?: 1 | 2): void { focusedConversationPanel()?.openDebugImageAnnotation(imageDataUrl, pixelRatio); }
const cockpitBacklogState = useCockpitBacklog({
  configure: (input) => props.configureWorkBacklog(input),
  confirmLoadAll: async () => {
    try {
      await ElMessageBox.confirm(
        translate('backlogSource.loadGlobalConfirmation'),
        translate('surface.appShell.loadTheGlobalBacklog'),
        {
          confirmButtonText: translate('dynamic.misc.loadEverything'),
          cancelButtonText: translate('common.cancel'),
          type: 'warning',
        },
      );
      return true;
    } catch {
      return false;
    }
  },
  getSnapshot: () => props.snapshot,
  getWorkBacklogError: provider => props.workBacklogStateFor ? props.workBacklogStateFor(provider).error : props.workBacklogError,
  getWorkBacklogStatus: provider => props.workBacklogStateFor ? props.workBacklogStateFor(provider).status : props.workBacklogStatus,
  getWorkItemsByRepository: () => props.workItemsByRepository,
  getWorkRepositories: (provider) => props.workRepositoriesByProvider[provider] ?? [],
  loadGlobalWorkItems: (query, provider) => props.loadGlobalWorkItems(provider, undefined, query),
  loadWorkItems: async (repositoryId, provider) => {
    await props.loadWorkItems(provider, repositoryId);
  },
  loadWorkRepositories: async (provider) => {
    await props.loadWorkRepositories(provider);
  },
});
const {
  changePage: changeGlobalWorkItemsPage,
  initialize: initializeCockpitBacklog,
  refresh: refreshWorkItems,
  selectAssignee: selectWorkAssigneeForCockpit,
  selectGlobalScope: selectGlobalBacklogScope,
  selectRepository: selectWorkRepositoryForCockpit,
  selectTag: selectWorkTagForCockpit,
  workBacklog: cockpitWorkBacklog,
} = cockpitBacklogState;
const currentProviderRuntime = computed<ProviderRuntimeStatus>(() => {
  const backend = currentAgent.value?.provider ?? defaultHarnessProvider;
  return props.snapshot.providerRuntimes.find((runtime) => runtime.provider === backend) ?? {
    provider: backend,
    status: 'notConfigured',
  };
});
const currentAgentGitStatus = computed<AgentGitStatus | null>(() => {
  const agentId = currentAgent.value?.id;
  return agentId ? props.snapshot.agentGitStatuses[agentId] ?? null : null;
});
const providerConversation = computed(() => {
  const agent = currentAgent.value;
  const view = agent ? conversationViewFor(agent.id) : null;
  return view ? conversationForView(view) : null;
});
const conversationMessages = computed(() => {
  const messages = providerConversation.value?.messages ?? [];
  const fixture = debugUserQuestions.value;
  if (!fixture || fixture.agentId !== currentAgent.value?.id) return messages;
  return [...messages, fixture.message];
});
const conversationLatestTurnId = computed(() => providerConversation.value?.latestTurnId ?? null);
function latestTurnIdForAgent(agentId: string): string | null {
  const view = props.agentConversationFor?.(agentId);
  return view ? conversationForView(view)?.latestTurnId ?? null : null;
}
const conversationHasRunningPlanTool = computed(() => conversationMessages.value.some(
  (message) => message.parts.some(
    (part) => part.type === 'tool' && part.status === 'running' && part.metadata?.planProgress === true,
  ),
));
const conversationPlan = computed(() => currentAgent.value ? conversationPlanForAgent(currentAgent.value, providerConversation.value) : null);
const managedModelFavorites = computed(() => modelFavoritesDialogBackend.value ? props.snapshot.general.modelFavorites.filter(favorite => favorite.provider === modelFavoritesDialogBackend.value) : []);
function buildModelFavoriteMenuItems(current: ModelFavorite | null, models: ProviderModelOption[]): ComposerMenuItem[] {
  if (!current) return [];
  const availableModelIds = new Set(models.map(model => model.id));
  const favorites = props.snapshot.general.modelFavorites.filter(favorite => favorite.provider === current.provider && availableModelIds.has(favorite.modelId));
  const currentIsFavorite = favorites.some((favorite) => sameModelFavorite(favorite, current));
  const items: ComposerMenuItem[] = [];
  if (favorites.length > 0) {
    items.push({
      id: 'model-favorites-heading',
      type: 'heading',
      label: translate('surface.appShell.favorites'),
      actions: [{
        id: 'model-favorite-add',
        type: 'action',
        label: translate('surface.appShell.addCurrentToFavorites'),
        icon: PlusIcon,
        disabled: currentIsFavorite,
        payload: { kind: 'model-favorite-add', favorite: current },
      }, {
        id: 'model-favorite-manage',
        type: 'action',
        label: translate('surface.appShell.manageFavorites'),
        icon: PencilIcon,
        payload: { kind: 'model-favorite-manage' },
      }],
    });
    items.push(...favorites.map((favorite) => {
      const fastTierLabel = modelFavoriteFastTierLabel(favorite, models);
      return {
        closeOnSelect: true,
        id: `model-favorite:${modelFavoriteKey(favorite)}`,
        label: modelFavoriteModelLabel(favorite, models),
        payload: { kind: 'model-favorite-select', favorite },
        type: 'action' as const,
        value: modelFavoriteEffortLabel(favorite),
        valueAppearance: 'badge' as const,
        valueIcon: fastTierLabel ? BoltIcon : undefined,
        valueIconLabel: fastTierLabel || undefined,
      };
    }));
  } else {
    items.push({
      id: 'model-favorite-add',
      type: 'action',
      label: translate('surface.appShell.addCurrentToFavorites'),
      icon: PlusIcon,
      payload: { kind: 'model-favorite-add', favorite: current },
    });
  }
  return items;
}
function conversationModelFavoriteMenuItems(agentId: string): ComposerMenuItem[] {
  const view = conversationViewFor(agentId);
  if (!view) return [];
  const composer = view.composer;
  const model = composer.models.find(model => model.id === composer.selectedModelId)
    ?? composer.models.find(model => model.isDefault) ?? composer.models[0];
  if (!model) return [];
  return buildModelFavoriteMenuItems({
    provider: view.agent.provider,
    modelId: model.id,
    reasoningEffort: composer.selectedReasoningEffort ?? model.defaultReasoningEffort ?? model.supportedReasoningEfforts?.[0]?.reasoningEffort ?? null,
    serviceTier: composer.selectedServiceTier === 'default' ? null : composer.selectedServiceTier,
  }, composer.models);
}
function selectConversationModelMenuItem(agentId: string, item: Parameters<NonNullable<ConversationPaneActions['menuSelect']>>[0]): void | Promise<void> {
  const command = modelFavoriteCommand(item.payload);
  if (command) return handleModelFavoriteCommand(command, props.agentConversationActions ? agentId : undefined);
}
const delegatingAgentIds = new Set<string>();
/** `/delegate` and `/mission` hand the conversation to the model, which carries out the request with a tool. */
async function sendModelCommand(agentId: string, command: '/delegate' | '/mission'): Promise<void> {
  if (delegatingAgentIds.has(agentId)) return;
  delegatingAgentIds.add(agentId);
  try {
    await backendSwitch.settled();
    if (!props.snapshot.agents.some(agent => agent.id === agentId)) throw new Error(t('delegation.agentUnavailable'));
    if (props.agentConversationActions) await props.agentConversationActions.send(agentId, command);
    else if (currentAgent.value?.id === agentId) {
      if (!preferredProviderChoices(props.snapshot, currentAgent.value?.remoteConnectionId).includes(currentAgent.value?.provider ?? defaultHarnessProvider)) throw new Error(t('engineConnection.required'));
      if (props.sendPromptAction) await props.sendPromptAction(command);
      else emit('sendPrompt', command);
    } else throw new Error(t('delegation.agentUnavailable'));
  } finally {
    delegatingAgentIds.delete(agentId);
  }
}

async function runConversationMenuCommand(agentId: string, command: ConversationMenuCommand): Promise<void> {
  try {
    if (command === 'design') return await startDesignForAgent(agentId);
    if (command === 'review') return await openCodeReviewForAgent(agentId);
    if (command === 'visualize') return await startVisualizeForAgent(agentId, { choose: true });
    await sendModelCommand(agentId, command === 'mission' ? '/mission' : '/delegate');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

type ModelFavoriteCommand =
  | { kind: 'model-favorite-add' | 'model-favorite-select'; favorite: ModelFavorite }
  | { kind: 'model-favorite-manage' };

function modelFavoriteCommand(payload: unknown): ModelFavoriteCommand | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const kind = record.kind;
  if (kind === 'model-favorite-manage') return { kind };
  if (kind !== 'model-favorite-add' && kind !== 'model-favorite-select') return null;
  const favorite = record.favorite;
  if (!favorite || typeof favorite !== 'object' || Array.isArray(favorite)) return null;
  return { kind, favorite: copyModelFavorite(favorite as ModelFavorite) };
}

async function handleModelFavoriteCommand(command: ModelFavoriteCommand, agentId?: string): Promise<void> {
  if (command.kind === 'model-favorite-manage') {
    modelFavoritesDialogBackend.value = (agentId ? props.snapshot.agents.find(agent => agent.id === agentId) : currentAgent.value)?.provider ?? null;
    modelFavoritesDialogVisible.value = modelFavoritesDialogBackend.value !== null;
    return;
  }
  if (command.kind === 'model-favorite-select') {
    if (agentId && props.agentConversationActions) {
      props.agentConversationActions.selectModel(agentId, command.favorite.modelId);
      if (command.favorite.reasoningEffort !== null) props.agentConversationActions.selectReasoningEffort(agentId, command.favorite.reasoningEffort);
      props.agentConversationActions.selectServiceTier(agentId, command.favorite.serviceTier);
      return;
    }
    emit('select-model', command.favorite.modelId);
    if (command.favorite.reasoningEffort !== null) {
      emit('select-reasoning-effort', command.favorite.reasoningEffort);
    }
    emit('select-service-tier', command.favorite.serviceTier);
    return;
  }
  const existing = props.snapshot.general.modelFavorites.map(copyModelFavorite);
  const modelFavorites = [
    ...existing.filter((favorite) => !sameModelFavorite(favorite, command.favorite)),
    copyModelFavorite(command.favorite),
  ];
  await props.updateSettings({ general: { modelFavorites } });
}

async function updateManagedModelFavorites(favorites: ModelFavorite[]): Promise<void> {
  const backend = modelFavoritesDialogBackend.value;
  if (!backend) return;
  const existing = props.snapshot.general.modelFavorites.map(copyModelFavorite);
  const firstBackendIndex = existing.findIndex((favorite) => favorite.provider === backend);
  const withoutBackend = existing.filter((favorite) => favorite.provider !== backend);
  const insertionIndex = firstBackendIndex < 0
    ? withoutBackend.length
    : existing.slice(0, firstBackendIndex).filter((favorite) => favorite.provider !== backend).length;
  withoutBackend.splice(insertionIndex, 0, ...favorites.map(copyModelFavorite));
  await props.updateSettings({ general: { modelFavorites: withoutBackend } });
}

function saveActivePromptDraft(): void {
  void focusedConversationPanel()?.saveCurrentDraft();
}

function openActiveSavedPromptDrafts(): void {
  void nextTick(() => {
    focusedConversationPanel()?.openSavedDraftPicker();
  });
}

function compactAgentSession(agentId: string): void {
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent || !defaultProviderCommands(agent.provider).some(command => command.slashName === 'compact')) return;
  emit('send-agent-prompt', { agentId, prompt: '/compact' });
}

const showAgentDialogTeamSelector = computed(() => agentDialogMode.value === 'create' && pendingNewAgentWorkItem.value !== null);
const pendingNewAgentName = '';
const pendingNewAgentWorktreeBranchName = computed(() => (
  pendingNewAgentWorkItem.value ? pendingWorkItemBranchName.value : agentDialogSourceBranchName.value
));
const isAgentEmpty = computed(() => activeTeamAgents.value.length === 0);
const cockpitVisible = computed(() => cockpitScope.value && (activeHost.value === 'agent' || activeHost.value === 'mission'));
const backlogVisible = computed(() => activeHost.value === 'backlog');
const automationsVisible = computed(() => activeHost.value === 'automations');
const settingsVisible = computed(() => activeHost.value === 'settings');
async function setEngineEnabled(provider: HarnessProvider, enabled: boolean) {
  if (!appApi) throw new Error('Backend connection is unavailable.');
  await appApi.setProviderEnabled(provider, enabled);
}
const isAgentWorkspaceVisible = computed(() => activeHost.value === 'agent');
const isModalDialogVisible = computed(() => (
  agentDialogVisible.value
  || shareTarget.value !== null
  || handoffAgentId.value !== null
  || modelFavoritesDialogVisible.value
  || newProjectDialogVisible.value
  || teamDialogVisible.value
  || whatsNewVisible.value
  || keyboardShortcutsVisible.value
  || commandPaletteVisible.value
  || conversationAnnotationVisible.value
  || missionDeleteTarget.value !== null
  || debugAgentCreationProgress.value !== null
  || fileQuickOpenVisible.value
  || agentQuickOpenVisible.value
  || props.codexResourceSharingMigrationRequired
));
// Dialogs take over the screen on phones; the drawer must not linger behind them.
watch(isModalDialogVisible, (visible) => { if (visible) compactNavOpen.value = false; });
const shortcutContext = computed<ShortcutContext>(() => ({
  platform: /Mac/i.test(navigator.platform) ? 'mac' : 'other',
  desktop: appClientPlatform === 'desktop',
  onboarding: showOnboardingGate.value,
  workspace: isAgentWorkspaceVisible.value && !showOnboardingGate.value,
  agent: Boolean(currentAgent.value),
  agentCount: activeTeamAgents.value.length,
  teamCount: props.snapshot.teams.length,
  browser: appHostCapabilities.embeddedBrowser,
  idleSession: Boolean(currentAgent.value?.providerSession && currentAgent.value.status.type === 'idle' && defaultProviderCommands(currentAgent.value.provider).some(command => command.slashName === 'compact')),
}));
const navigation = ref<InstanceType<typeof AppShellNavigation> | null>(null);
const { quickAgentShortcutsVisible, executeAppCommand } = useAppShellCommands({
  state: {
    activeTeam: () => activeTeam.value,
    activeTeamAgents: () => featureWindow.value ? orderAgentsLikeWorktreeSidebar(activeTeamAgents.value, featureAgents.value, activeTeam.value?.featureOrder) : activeTeamAgents.value,
    quickSwitchAgentIds: () => navigation.value?.quickSwitchAgentIds ?? activeTeamAgents.value.map(agent => agent.id),
    agents: () => props.snapshot.agents,
    attachmentsEnabled: () => props.providerCapabilities.attachments,
    composerAttachments: () => props.composerAttachments,
    currentAgent: () => hasFocusedConversation.value ? currentAgent.value : null,
    canReplaceConversation: () => Boolean(currentAgent.value && summaryReplacementAgentIds.value.includes(currentAgent.value.id)),
    isAgentWorkspaceVisible: () => isAgentWorkspaceVisible.value,
    windowScope: () => windowScope.value,
    isModalDialogVisible: () => isModalDialogVisible.value,
    showOnboardingGate: () => showOnboardingGate.value,
    teams: () => props.snapshot.teams,
  },
  actions: {
    closeAgent: (agentId) => emit('close-agent', agentId),
    compactSession: compactAgentSession,
    replaceConversationWithSummary: (agentId) => emit('compress-session', agentId),
    debugMarkUnread: () => emit('debug-mark-unread'),
    duplicateAgent: (agentId) => emit('duplicate-agent', agentId),
    editAgent: openEditAgent,
    forkAgent: (agentId) => { if (forkableAgentIds.value.includes(agentId)) emit('fork-agent', agentId); },
    handoffAgent: openHandoff,
    focusComposer: () => focusedConversationPanel()?.focusComposer(),
    newTeam: openNewTeam,
    openAgentPalette: () => { agentQuickOpenVisible.value = true; },
    openSavedPromptDrafts: openActiveSavedPromptDrafts,
    openAgentSurface: () => { activeHost.value = 'agent'; },
    openBrowser: (command) => agentWorkspace.value?.handleBrowserOpenCommand(command),
    openDebugImageAnnotation,
    openDebugOperationProgress,
    setDebugMissingEngines: enabled => { debugMissingEngines.value = enabled; },
    setDebugProviderUpgrades: enabled => { debugProviderUpgrades.value = enabled; },
    setDebugReviewUncommitted: enabled => { debugReviewUncommitted.value = enabled; },
    openFileQuick: () => { fileQuickOpenVisible.value = true; },
    openGitReview: openAgentGitDiffPreview,
    openMarkdown: openMarkdownRequest,
    openRightWorkspaceTab: (tab, agentId) => openRightWorkspaceTab(tab, agentId),
    closeRightWorkspaceTab: (tab, agentId) => closeRightWorkspaceTabLocal(agentId, tab),
    openSettings,
    openWhatsNew,
    openKeyboardShortcuts: () => { keyboardShortcutsVisible.value = true; },
    openCommandPalette: () => { commandPaletteVisible.value = true; },
    quit,
    restartAgent: (agentId) => emit('restart-agent', agentId),
    resumeSession: openResumeSession,
    savePromptDraft: saveActivePromptDraft,
    selectAgent: selectAgentFromShell,
    selectTeam: selectTeamFromRail,
    sendAgentPrompt: (agentId, prompt) => emit('send-agent-prompt', { agentId, prompt }),
    setDebugApproval: (approval) => { debugApproval.value = approval; },
    showDebugUserQuestions,
    showDebugProviderSafetyBlock: (agentId) => previewProviderSafetyBlock(agentId),
    toggleSpokenAnnouncementsMuted,
    updateComposerAttachments: (agentId, attachments) => emit('update:composerAttachments', { agentId, attachments }),
    updateComposerState: (agentId, state) => emit('update:composerState', { agentId, state }),
  },
});

const paletteActions = computed(() => {
  const agent = hasFocusedConversation.value ? currentAgent.value : null;
  const team = activeTeam.value;
  const remote = agent?.remoteConnectionId;
  return commandPaletteActions({
    shortcuts: shortcutContext.value, agent, team,
    settings: { embeddedBrowser: appHostCapabilities.embeddedBrowser, appshots: appHostCapabilities.appshots, availableProviders: props.snapshot.providerConnections?.map(provider => provider.provider) ?? [] },
    connected: props.connectionState.status === 'connected',
    hostConnected: !remote || props.snapshot.remoteConnections.connections.some(connection => connection.id === remote && connection.status === 'ready'),
    engineConnected: Boolean(agent && preferredProviderChoices(props.snapshot, agent.remoteConnectionId).includes(agent.provider)),
    canCreateAgent: Boolean(preferredProviderChoices(props.snapshot).length),
    capabilities: { ...defaultProviderCapabilities(agent?.provider ?? defaultHarnessProvider), ...currentProviderRuntime.value.capabilities },
    gitAvailable: Boolean(currentAgentGitStatus.value && currentAgentGitStatus.value.state !== 'unknown'),
    planAvailable: Boolean(agent && rightWorkspaceFor(agent.id).planPanel),
    simulatorAvailable: Boolean(appApi?.mobileSimulator),
    gitActions: agentWorkspace.value?.getCommandActions?.() ?? [],
  }, {
    command: executeAppCommand,
    settings: openSettings,
    cockpit: openCockpit,
    backlog: openBacklog,
    automations: openAutomations,
    quickChat: createQuickChat,
    newAgent: () => openNewAgent(team?.id),
    files: () => { fileQuickOpenVisible.value = true; },
    filesPane: () => { if (agent) agentWorkspace.value?.openRightWorkspaceTabFromMenu(agent.id, 'files'); },
    codeReview: () => { if (agent) return openCodeReviewForAgent(agent.id); },
    simulator: () => { if (agent) agentWorkspace.value?.openRightWorkspaceTabFromMenu(agent.id, 'simulator'); },
    design: () => { if (agent) return startDesignForAgent(agent.id); },
    visualize: () => { if (agent) return startVisualizeForAgent(agent.id); },
    plan: () => openRightWorkspaceTab('plan', agent?.id),
  });
});
async function executePaletteAction(selected: CommandPaletteAction): Promise<void> {
  commandPaletteVisible.value = false;
  await nextTick();
  const action = paletteActions.value.find(candidate => candidate.id === selected.id && candidate.scope === selected.scope);
  if (!action || action.disabledReason || isModalDialogVisible.value) return;
  try { await action.run(); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : String(error)); }
}

function showDebugUserQuestions(agentId: string): void {
  const requestId = 'debug-user-questions';
  const turnId = 'debug-user-questions-turn';
  const itemId = 'debug-user-questions-item';
  debugUserQuestions.value = {
    agentId,
    requestId,
    message: {
      id: 'debug-user-questions-message',
      role: 'assistant',
      status: 'complete',
      turnId,
      parts: [
        {
          type: 'text',
          text: 'I need two decisions before continuing.',
          phase: 'final_answer',
        },
        {
          type: 'question',
          request: {
            id: requestId,
            kind: 'question',
            conversationId: `debug-${agentId}`,
            turnId,
            itemId,
            question: {
                itemId,
                delivery: 'async',
                blocking: false,
                questions: [
                  {
                    id: 'debug-user-questions-core-flow',
                    header: 'Core flow',
                    question: `What should the first Linear integration let a ${product.name} user do?`,
                    isOther: true,
                    isSecret: false,
                    options: [
                      {
                        label: 'Mission ↔ Linear (Recommended)',
                        description: 'Import a Linear issue into a Mission and sync its status, tickets, and links back.',
                      },
                      {
                        label: 'Import only',
                        description: 'Use Linear issues as Mission input without writing anything back.',
                      },
                      {
                        label: 'Full workspace sync',
                        description: 'Keep Missions, issues, comments, and statuses synchronized both ways.',
                      },
                    ],
                  },
                  {
                    id: 'debug-user-questions-review-cadence',
                    header: 'Review cadence',
                    question: 'When should implementation pause for your review?',
                    isOther: true,
                    isSecret: false,
                    options: [
                      {
                        label: 'After each ticket (Recommended)',
                        description: 'Review each completed ticket before its repository worker continues.',
                      },
                      {
                        label: 'After each repository',
                        description: 'Let one worker finish its repository queue before review.',
                      },
                      {
                        label: 'After implementation',
                        description: 'Run every ready ticket and review the combined result once.',
                      },
                    ],
                  },
                ],
              },
          },
        },
      ],
    },
  };
}

const previewProviderSafetyBlock = useDebugProviderSafetyBlock();
const previewWorktreeInitialization = useDebugWorktreeInitialization();

function openDebugOperationProgress(
  kind: Extract<AppCommand, { type: 'debug-operation-progress' }>['kind'],
): void {
  if (kind === 'worktreeIndicator') {
    previewWorktreeInitialization(currentAgent.value);
    return;
  }
  if (kind === 'worktreeInitialization') {
    startDebugAgentCreationProgress();
    return;
  }

  activeHost.value = 'agent';
  void nextTick(() => agentWorkspace.value?.showDebugGitOperationProgress(kind));
}

function startDebugAgentCreationProgress(): void {
  clearDebugAgentCreationTimers();
  const id = `debug-agent-creation-${Date.now()}`;
  debugAgentCreationProgress.value = {
    id,
    state: 'running',
    provider: defaultHarnessProvider,
    repositoryName: 'agent-workspace',
    createWorktree: true,
    branchName: 'debug/worktree-preview',
    hasPrompt: true,
    phase: 'creatingWorktree',
  };
  scheduleDebugAgentCreationUpdate(id, 1_200, {
    phase: 'initializingWorktree',
    initializationDetail: 'Repository instructions · npm install',
  });
  scheduleDebugAgentCreationUpdate(id, 3_200, { phase: 'creatingAgent' });
  scheduleDebugAgentCreationUpdate(id, 4_700, { phase: 'startingPrompt' });
  scheduleDebugAgentCreationUpdate(id, 6_200, {
    state: 'success',
    agentId: 'debug-agent',
    agentName: 'debug/worktree-preview',
  });
}

function scheduleDebugAgentCreationUpdate(
  id: string,
  delay: number,
  update: Partial<AgentCreationProgress>,
): void {
  debugAgentCreationTimers.push(setTimeout(() => {
    if (debugAgentCreationProgress.value?.id !== id) return;
    debugAgentCreationProgress.value = { ...debugAgentCreationProgress.value, ...update };
  }, delay));
}

const provisioningProgress = computed(() => debugAgentCreationProgress.value ?? repositorySessionCreationProgress.value);
// Local flows first, then agent-delegated creations (one, or several side by side).
const provisioningOperation = computed<WorkspaceProvisioningOperation | null>(() => {
  if (provisioningProgress.value) return { mode: 'single', progress: provisioningProgress.value };
  if (workItemCreationProgress.value) return workItemCreationProgress.value;
  const delegated = props.agentCreationProgresses ?? [];
  if (delegated.length === 1) return { mode: 'single', progress: delegated[0]! };
  return delegated.length > 1 ? { mode: 'batch', progress: delegated } : null;
});

watch(provisioningOperation, (operation) => {
  publishProvisioningOperation('shell', operation, { onClose: closeProvisioningProgress, onBackground: backgroundProvisioningProgress });
}, { immediate: true });
onBeforeUnmount(() => publishProvisioningOperation('shell', null));

function closeProvisioningProgress(id: string): void {
  closeDebugAgentCreationProgress(id);
  closeRepositorySessionCreationProgress(id);
  closeWorkItemCreationProgress(id);
  emit('clear-agent-creation-progress', id);
}

function backgroundProvisioningProgress(id: string): void {
  closeDebugAgentCreationProgress(id);
  backgroundRepositorySessionCreationProgress(id);
  backgroundWorkItemCreationProgress(id);
  emit('background-agent-creation-progress', id);
}

function closeDebugAgentCreationProgress(id: string): void {
  if (debugAgentCreationProgress.value?.id !== id) return;
  clearDebugAgentCreationTimers();
  debugAgentCreationProgress.value = null;
}

function clearDebugAgentCreationTimers(): void {
  debugAgentCreationTimers.splice(0).forEach((timer) => clearTimeout(timer));
}

onBeforeUnmount(clearDebugAgentCreationTimers);
const showAgentSidebar = computed(() => (isAgentWorkspaceVisible.value || activeHost.value === 'mission') && (compactViewport.value || !agentSidebarCollapsed.value) && (props.snapshot.teams.length > 0 || !!props.snapshot.missions?.length));
const editingAgent = computed(() => (
  editingAgentId.value ? props.snapshot.agents.find((agent) => agent.id === editingAgentId.value) ?? null : null
));
const editingTeam = computed(() => (
  editingTeamId.value ? props.snapshot.teams.find((team) => team.id === editingTeamId.value) ?? null : null
));
onMounted(() => {
  void loadAuthentication();
});

function setAgentSidebarWidth(width: number): void {
  agentSidebarWidth.value = Math.min(Math.max(width, agentSidebarMinWidth), agentSidebarMaxWidth);
}

function openNewAgent(
  teamId?: string,
  sourceRepositoryName: string | null = null,
  sourceBranchName = '',
): void {
  agentDialogMode.value = 'create';
  editingAgentId.value = null;
  agentDialogTeamId.value = teamId ?? activeTeam.value?.id ?? null;
  agentDialogSourceRepositoryName.value = sourceRepositoryName;
  agentDialogSourceBranchName.value = sourceBranchName;
  agentDialogVisible.value = true;
}

function repositorySessionContext(source?: Pick<RepositorySessionSource, 'agentId' | 'teamId'> | null) {
  return resolveRepositorySessionContext(props.snapshot, source, activeTeam.value?.id);
}

async function createQuickChat(): Promise<void> {
  const { teamId } = repositorySessionContext(null);
  try {
    const backend = preferredProviderChoices(props.snapshot)[0];
    if (!backend) { openSettings(); return; }
    const created = await props.createQuickChat({ selection: { provider: backend }, ...(teamId ? { teamId } : {}) });
    if (created !== null) activeHost.value = 'agent';
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleStartWorkAction(action: import('./start-work-actions').StartWorkAction): Promise<void> {
  if (action === 'invite') { emit('join-invite'); return; }
  if (action === 'new') {
    newProjectError.value = null;
    newProjectDialogVisible.value = true;
    return;
  }
  if (action === 'local') {
    await openExistingRepositoryFolder();
    return;
  }
  await openRepositoryAcquire(action);
}

function closeNewProjectDialog(): void {
  if (newProjectBusy.value) return;
  newProjectDialogVisible.value = false;
  newProjectError.value = null;
}

async function createNewProject(name: string, provider: Agent['provider']): Promise<void> {
  if (newProjectBusy.value) return;
  const { teamId } = repositorySessionContext(null);
  newProjectBusy.value = true;
  newProjectError.value = null;
  try {
    if (!props.snapshot.sourceFolder.path.trim()) {
      const folder = await props.chooseSourceFolder();
      if (!folder) return;
      await props.updateSettings({ sourceFolder: { path: folder } });
    }
    await props.createProject({
      name,
      selection: { provider },
      ...(teamId ? { teamId } : {}),
    });
    newProjectDialogVisible.value = false;
  } catch (error) {
    newProjectError.value = localizedErrorMessage(error, t);
  } finally {
    newProjectBusy.value = false;
  }
}

function openNewTeam(): void {
  teamDialogMode.value = 'create';
  editingTeamId.value = null;
  teamDialogVisible.value = true;
}

function openEditTeam(teamId: string): void {
  teamDialogMode.value = 'edit';
  editingTeamId.value = teamId;
  teamDialogVisible.value = true;
}

function openEditAgent(agentId: string): void {
  agentDialogMode.value = 'edit';
  editingAgentId.value = agentId;
  agentDialogTeamId.value = null;
  agentDialogSourceRepositoryName.value = null;
  agentDialogSourceBranchName.value = '';
  agentDialogVisible.value = true;
}

function closeAgentDialog(): void {
  agentDialogVisible.value = false;
  editingAgentId.value = null;
  agentDialogTeamId.value = null;
  agentDialogSourceRepositoryName.value = null;
  agentDialogSourceBranchName.value = '';
  clearPendingNewAgentWorkItem();
}

async function createAgentFromDialog(input: CreateAgentInput & { newTeamName?: string; teamId?: string }): Promise<void> {
  const { newTeamName, ...agentInput } = input;
  const targetTeamId = agentDialogMode.value === 'create'
    ? await resolveSelectedTeam(input.teamId ?? agentDialogTeamId.value, newTeamName)
    : null;
  const agent = await props.createAgent(targetTeamId ? { ...agentInput, teamId: targetTeamId } : agentInput);
  assignPendingWorkItemToCreatedAgent(agent);
}

async function resolveSelectedTeam(teamId: string | null | undefined, newTeamName?: string): Promise<string | null> {
  const trimmedNewTeamName = newTeamName?.trim() ?? '';
  if (trimmedNewTeamName) {
    const team = await props.createTeam({
      name: trimmedNewTeamName,
      color: defaultTeamColor,
    });
    return team?.id ?? props.snapshot.activeTeamId ?? null;
  }

  return teamId?.trim() || props.snapshot.activeTeamId;
}

function openCockpit(): void {
  cockpitScope.value = true;
  activeHost.value = 'agent';
  if (currentAgent.value && currentAgent.value.id !== props.activeAgent?.id) emit('select-agent', currentAgent.value.id);
}

async function openBacklog(): Promise<void> {
  if (backlogVisible.value && backlogInitialized) return;
  activeHost.value = 'backlog';
  backlogInitialized = true;
  await initializeCockpitBacklog();
}

function openAutomations(): void {
  activeHost.value = 'automations';
}

function openSettings(tab?: SettingsTab): void {
  if (activeHost.value !== 'settings') {
    settingsReturnMissionId.value = activeHost.value === 'mission' ? selectedMissionId.value : null;
  }
  if (tab) settingsActiveTab.value = tab;
  activeHost.value = 'settings';
}

function toggleSpokenAnnouncementsMuted(): void {
  if (!props.snapshot.general.spokenAnnouncementsEnabled) return;
  void updateSettings({
    general: {
      spokenAnnouncementsMuted: !props.snapshot.general.spokenAnnouncementsMuted,
    },
  });
}

function openWhatsNew(): void {
  whatsNewVisible.value = true;
}

async function createAutomation(input: CreateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.createAutomation(input, location);
}

async function updateAutomation(input: UpdateAutomationInput, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.updateAutomation(input, location);
}

async function runAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.runAutomation(automationId, location);
}

async function clearAutomationHistory(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.clearAutomationHistory(automationId, location);
}

async function deleteAutomationExecution(automationId: string, executionId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.deleteAutomationExecution(automationId, executionId, location);
}

async function deleteAutomation(automationId: string, location?: AutomationLocation): Promise<AppSnapshot | void> {
  return props.deleteAutomation(automationId, location);
}

async function readConversationMessages(ref: ProviderConversationRef, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]> {
  return location
    ? props.readConversationMessages(ref, agentId, location)
    : props.readConversationMessages(ref, agentId);
}

async function listAgentConversations(agentId: string, input?: ConversationListInput): Promise<ConversationSummary[]> {
  return props.listAgentConversations(agentId, input);
}

async function resumeAgentConversation(agentId: string, target: ConversationResumeTarget): Promise<void> {
  await props.resumeAgentConversation(agentId, target);
}

function selectTeamFromRail(teamId: string): void {
  cockpitScope.value = false;
  if (activeHost.value === 'settings' && settingsReturnMissionId.value === selectedMission.value?.id
    && selectedMission.value.teamId === teamId) {
    selectMissionSurface(selectedMission.value.id);
  } else {
    activeHost.value = 'agent';
  }
  emit('select-team', teamId);
}

function selectAgentFromShell(agentId: string): void {
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId);
  if (cockpitScope.value && missionOwnedAgentIds.value.has(agentId)) return;
  if (cockpitScope.value && agent?.teamId && agent.teamId !== activeTeam.value?.id) emit('select-team', agent.teamId);
  activeHost.value = 'agent';
  pendingComposerFocusAgentId.value = agentId;
  split.select(agentId);
  emit('select-agent', agentId);
}

function selectAgentFromBacklog(payload: { agentId: string; teamId: string }): void {
  cockpitScope.value = false;
  activeHost.value = 'agent';
  pendingComposerFocusAgentId.value = payload.agentId;
  emit('select-team', payload.teamId);
  emit('select-agent', payload.agentId);
}

function selectAgentFromPalette(payload: { agentId: string; teamId: string }): void {
  const agent = quickOpenAgents.value.find(candidate => candidate.id === payload.agentId);
  const teamId = agent?.teamId ?? props.snapshot.teams.find(team => team.agentIds.includes(payload.agentId))?.id;
  if (!agent || !teamId) return;
  pendingMissionFocusId.value = null;
  activeHost.value = missionWindow.value ? 'mission' : 'agent';
  pendingComposerFocusAgentId.value = payload.agentId;
  if (teamId === activeTeam.value?.id) split.select(payload.agentId);
  if (teamId !== activeTeam.value?.id) emit('select-team', teamId);
  emit('select-agent', payload.agentId);
}

function selectMissionFromPalette(missionId: string): void {
  const mission = quickOpenMissions.value.find(candidate => candidate.id === missionId);
  if (!mission) return;
  if (!cockpitScope.value && mission.teamId !== activeTeam.value?.id) {
    pendingMissionFocusId.value = mission.id;
    emit('select-team', mission.teamId);
    return;
  }
  void selectMission(mission.id);
}

function openResumeSession(agentId: string): void {
  resumeSessionAgentId.value = agentId;
}

async function updatePlanReview(agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) {
  if (!props.updatePlanReview) throw new Error('Plan review is unavailable.');
  const review = await props.updatePlanReview(agentId, response);
  if (response.resolution !== 'save') {
    if (currentAgent.value?.id === agentId) emit('update:planMode', response.resolution === 'revise');
    if (response.resolution !== 'revise') closeRightWorkspaceTab(agentId, 'plan');
  }
  return review;
}

function forwardApprovalResolution(
  approvalId: string,
  decision: ProviderApprovalDecision,
  scope: ProviderApprovalScope,
): void {
  if (debugApproval.value?.request.id === approvalId) {
    debugApproval.value = null;
    return;
  }
  emit('resolve-approval', approvalId, decision, scope);
}

async function startCodeReviewFromShell(
  agentId: string,
  input: import('@workspace/core/code-review').CodeReviewStartInput,
): Promise<AppSnapshot> {
  const next = await props.startCodeReview(agentId, input);
  const reviewerAgentId = input.threadMode === 'independent'
    ? next.activeAgentId
    : agentId;
  if (reviewerAgentId) {
    if (input.threadMode === 'independent' && reviewerAgentId !== agentId) {
      closeRightWorkspaceTab(agentId, 'codeReview');
    }
    selectAgentFromShell(reviewerAgentId);
    openRightWorkspaceTab('codeReview', reviewerAgentId);
  }
  return next;
}

function clarifyCodeReviewFinding(payload: {
  agentId: string;
  sessionId: string;
  roundId: string;
  finding: import('@workspace/core/code-review').CodeReviewFinding;
}): void {
  const { finding } = payload;
  pendingReviewClarification.value = {
    agentId: payload.agentId,
    sessionId: payload.sessionId,
    roundId: payload.roundId,
    findingId: finding.id,
    finding,
  };
  selectAgentFromShell(payload.agentId);
  void nextTick(() => focusedConversationPanel()?.focusComposer());
}

function prepareMissionReviewDiscussion(payload: PendingMissionReviewDiscussion): void {
  const text = missionReviewDiscussionPrompt(payload.finding);
  emit('update:composerState', {
    agentId: payload.agentId,
    state: { text, selectionStart: text.length, selectionEnd: text.length },
  });
  void nextTick(() => focusedConversationPanel()?.focusComposer());
}

function forwardPrompt(prompt: string, options?: RendererSendPromptOptions): void | Promise<void> {
  const agentId = currentAgent.value?.id;
  if (agentId) return conversationActions.value.send(agentId, prompt, options);
}

function missionReviewDiscussionPrompt(
  finding: import('@workspace/core/missions').MissionReviewFinding,
): string {
  const location = finding.location
    ? `${finding.location.file}${finding.location.line ? `:${finding.location.line}` : ''}`
    : '';
  return [
    'Discuss this Mission Review finding:',
    `[${finding.priority.toUpperCase()}] ${finding.title}`,
    `Repository: ${finding.repositoryPath}`,
    ...(location ? [`Location: ${location}`] : []),
    finding.body,
    '',
    'Question: ',
  ].join('\n');
}

function forwardSteerPrompt(prompt: string, options?: RendererSendPromptOptions): void {
  if (options) {
    emit('steerPrompt', prompt, options);
  } else {
    emit('steerPrompt', prompt);
  }
}

async function openAgentIn(
  agentId: string,
  application: OpenInApplication,
  filePath?: string,
): Promise<void> {
  try {
    await props.openAgentPath(agentId, application, filePath);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

 async function updateSettings(input: UpdateSettingsInput): Promise<void> {
  await props.updateSettings(input);
}

function copyPromptDraft(draft: AppSnapshot['general']['savedPromptDrafts'][number]) {
  return { ...draft, ...(draft.content === undefined ? {} : { content: normalizePromptContent(draft.content) }) };
}

async function savePromptDraft(agentId: string, text: string, content?: readonly import('@korus-dev/multi-agent-sdk').PromptPart[]): Promise<void> {
  if (!text.trim() || text.length > 131_072) throw new Error(t('chat.savedDrafts.invalid'));
  const savedPromptDrafts = [...props.snapshot.general.savedPromptDrafts.map(copyPromptDraft), {
    id: crypto.randomUUID(), agentId, text, ...(content === undefined ? {} : { content: normalizePromptContent(content) }), createdAt: Date.now(),
  }].slice(-100);
  await updateSettings({ general: { savedPromptDrafts } });
}

async function removePromptDraft(id: string): Promise<void> {
  await updateSettings({ general: { savedPromptDrafts: props.snapshot.general.savedPromptDrafts.filter((draft) => draft.id !== id).map(copyPromptDraft) } });
}

async function updateRepositoryIcon(payload: {
  repositoryKey: string;
  repositoryRoot: string;
  icon: string | undefined;
}): Promise<void> {
  const repositoryIcons = { ...props.snapshot.general.repositoryIcons };
  if (payload.icon) {
    repositoryIcons[payload.repositoryKey] = payload.icon;
    if (payload.repositoryKey !== payload.repositoryRoot) delete repositoryIcons[payload.repositoryRoot];
  } else {
    delete repositoryIcons[payload.repositoryKey];
    delete repositoryIcons[payload.repositoryRoot];
  }
  await updateSettings({ general: { repositoryIcons } });
}

async function updateCollapsedRepositories(collapsedRepositoryKeys: string[]): Promise<void> {
  await updateSettings({ general: { collapsedRepositoryKeys } });
}

async function updateBacklogRepositoryFavorites(repositoryIds: string[]): Promise<void> {
  const backlogRepositoryFavorites = { [cockpitBacklogState.provider.value]: [...repositoryIds] };
  await updateSettings({ general: { backlogRepositoryFavorites } });
}

async function setCodexResourceSharing(input: SetCodexResourceSharingInput): Promise<void> {
  await props.setCodexResourceSharing(input);
}

async function migrateCodexResources(): Promise<void> {
  if (codexResourceSharingBlocked.value || codexResourceSharingMigrationPending.value) return;
  codexResourceSharingMigrationPending.value = true;
  try {
    await setCodexResourceSharing({ enabled: true });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    codexResourceSharingMigrationPending.value = false;
  }
}

async function declineCodexResourceSharingMigration(): Promise<void> {
  if (codexResourceSharingMigrationPending.value) return;
  codexResourceSharingMigrationPending.value = true;
  try {
    await setCodexResourceSharing({ enabled: false, mode: 'keep' });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    codexResourceSharingMigrationPending.value = false;
  }
}

async function getPluginStatus(): Promise<import('@workspace/core/contracts').AppPluginStatus> {
  return props.getPluginStatus();
}

async function setDaemonEnabled(enabled: boolean): Promise<void> {
  await props.setDaemonEnabled(enabled);
}

async function restartApp(): Promise<void> {
  await props.restartApp();
}

async function connectWorkProvider(provider: WorkProviderKind, options?: import('@workspace/core/contracts').WorkProviderConnectOptions): Promise<void> {
  if (options) await props.connectWorkProvider(provider, options);
  else await props.connectWorkProvider(provider);
}

async function pollWorkProviderAuthorization(provider: WorkProviderKind): Promise<void> {
  await props.pollWorkProviderAuthorization(provider);
}

async function disconnectWorkProvider(provider: WorkProviderKind): Promise<void> {
  await props.disconnectWorkProvider(provider);
}

async function quit(): Promise<void> {
  await props.quit();
}

 const activeTeamName = computed(() => activeTeam.value?.name ?? `${product.name}`);
const resumeSessionAgent = computed(() => (
  props.snapshot.agents.find((agent) => agent.id === resumeSessionAgentId.value) ?? null
));
watch(() => props.markdownDisplayRequests, (requests) => {
  if (!requests.length) return;
  for (const request of requests) if (!missionDocuments.request(request)) openMarkdownRequest(request);
  emit('consume-markdown-displays', requests.length);
}, { immediate: true });

watch(() => props.sidePanelRequest, (request) => {
  if (!request) {
    return;
  }

  openSidePanelRequest(request);
}, { immediate: true, flush: 'sync' });

watch(() => props.snapshot.agents.map(agent => [agent.id, agent.planReview?.id, agent.planReview?.status] as const), (reviews, previous) => {
  for (const [agentId, id, status] of reviews) {
    if (id && (status === 'pending' || status === 'revise') && !previous?.some(r => r[0] === agentId && r[1] === id)) openRightWorkspaceTab('plan', agentId);
    if (status === 'accept' || status === 'cancel') closeRightWorkspaceTab(agentId, 'plan');
  }
}, { immediate: true });

watch(() => props.fileActivity, (activity) => {
  if (activity) handleFileActivity(activity);
});

</script>

<style scoped>
.app-shell__empty-cockpit {
  margin: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}

.app-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-shell-window);
}

.app-shell--auth-gated > :not(.codex-login):not(.repositories-onboarding):not(.onboarding-complete) {
  visibility: hidden;
}

.app-shell__nav {
  display: contents;
}

/* Without the rail, nothing keeps the macOS window controls clear of the first row of content: the sidebar header of a team
   or feature window, the header of a window for one agent, or the header of a window whose sidebar is collapsed. */
html[data-platform='macos'] .app-shell--no-rail :deep(.agent-sidebar__header),
html[data-platform='macos'] .app-shell--chromeless :deep(.workspace-header),
html[data-platform='macos'] .app-shell--no-rail.app-shell--sidebar-collapsed :deep(.workspace-header) {
  padding-left: calc(var(--team-rail-width) + var(--space-16));
}

.app-shell__compact-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: var(--workbench-appbar-height);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.app-shell__content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
  background: var(--color-shell-main);
}

@media (max-width: 768px) {
  .app-shell__nav {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 20;
    display: flex;
    max-width: 88vw;
    background: var(--color-shell-window);
    box-shadow: var(--shadow-lg);
    transform: translateX(-105%);
    transition: transform 180ms ease;
  }

  .app-shell__nav--open {
    transform: none;
  }

  .app-shell__nav-backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
    background: var(--color-dialog-overlay);
  }
}

@media (max-width: 768px) and (prefers-reduced-motion: reduce) {
  .app-shell__nav {
    transition-duration: 1ms;
  }
}
</style>
