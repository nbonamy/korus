<template>
  <main
    class="app-shell"
    :class="{ 'app-shell--auth-gated': showOnboardingGate }"
  >
    <FirstRunOnboardingGate
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
      :github-onboarding-visible="!debugMissingEngines && githubOnboardingVisible"
      :initial-authentication-loading="!debugMissingEngines && initialAuthenticationLoading"
      :onboarding-complete-visible="!debugMissingEngines && onboardingCompleteVisible"
      :repository-acquire-busy="repositoryAcquireBusy"
      :repository-acquire-error="repositoryAcquireError"
      :show-login-landing="showLoginLanding"
      :snapshot="snapshot"
      :work-backlog-error="workBacklogError"
      :work-provider-authorization="workProviderAuthorization"
      @cancel="cancelChatGptLogin"
      @complete="completeGitHubOnboardingStep"
      @connect-github="connectGitHub"
      @finish="finishFirstRunOnboarding"
      @login="startChatGptLogin"
      @open-github-authorization="openGitHubAuthorization"
    />
    <div
      class="app-shell__nav"
      :class="{ 'app-shell__nav--compact': compactViewport, 'app-shell__nav--open': compactNavOpen }"
    >
    <AppShellNavigation
      ref="navigation"
      :active-mission-id="activeSurface === 'mission' ? selectedMissionId : null"
      :mission-creation-error="missionCreationError"
      :mission-creation-pending="missionCreationPending"
      :phone-scope="compactViewport"
      @create-mission="createNewMission"
      @delete-mission="deleteMissionFromSidebar"
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
      :load-remote-teams="loadRemoteTeams"
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
      @create-quick-chat="createQuickChat"
      @disconnect-team="$emit('disconnect-team', $event)"
      @duplicate-agent="$emit('duplicate-agent', $event)"
      @edit-agent="openEditAgent"
      @edit-team="openEditTeam"
      @fork-agent="$emit('fork-agent', $event)"
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
      v-if="compactViewport && compactNavOpen"
      class="app-shell__nav-backdrop"
      aria-hidden="true"
      @click="compactNavOpen = false"
    />
    <section class="app-shell__content">
      <BackendConnectionBanner :connection-state="connectionState" />
      <header v-if="compactViewport && !isAgentWorkspaceVisible && activeSurface !== 'mission'" class="app-shell__compact-bar">
        <SidebarExpandButton :label="t('surface.agentHeader.showAgentSidebar')" @click="expandSidebar" />
      </header>
      <SettingsView
        v-if="settingsVisible"
        :codex-connected="!debugMissingEngines && codexConnected"
        :provider-connections="displayProviderConnections"
        :refresh-provider="refreshProvider"
        :install-provider="installProvider"
        :provider-setup-error="setupError"
        :updating-provider="updatingProvider"
        :customize-provider="customizeProvider"
        :claude-connected="!debugMissingEngines && claudeConnected"
        :codex-connection-busy="!debugMissingEngines && (authenticationLoading || snapshot.providerConnections?.some(engine => engine.backend === 'codex' && engine.checking))"
        :set-provider-enabled="setEngineEnabled"
        :claude-connection-busy="!debugMissingEngines && (claudeLoading || snapshot.providerConnections?.some(engine => engine.backend === 'claude' && engine.checking))"
        :codex-login-pending="!debugMissingEngines && authentication?.login.status === 'pending'"
        :codex-connection-error="debugMissingEngines ? null : authenticationError ?? authentication?.login.error ?? snapshot.providerConnections?.find(engine => engine.backend === 'codex')?.error"
        :claude-connection-error="debugMissingEngines ? null : claudeError ?? snapshot.providerConnections?.find(engine => engine.backend === 'claude')?.error"
        :connect-codex="startChatGptLogin"
        :connect-claude="connectClaude"
        :connect-antigravity="connectAntigravity"
        :cancel-antigravity-login="cancelAntigravityLogin"
        :antigravity-connection-busy="!debugMissingEngines && (antigravityLoading || snapshot.providerConnections?.some(engine => engine.backend === 'antigravity' && engine.checking))"
        :antigravity-login-pending="!debugMissingEngines && antigravityPending"
        :antigravity-connection-error="debugMissingEngines ? null : antigravityError ?? snapshot.providerConnections?.find(engine => engine.backend === 'antigravity')?.error"
        :disconnect-provider="disconnectProvider"
        :cancel-codex-login="cancelChatGptLogin"
        :active-tab="settingsActiveTab"
        :general-settings="snapshot.general"
        :settings="snapshot.theme"
        :source-folder="snapshot.sourceFolder"
        :work-backlog-connections="snapshot.workBacklog.connections"
        :work-backlog-error="workBacklogError"
        :work-backlog-status="workBacklogStatus"
        :work-provider-settings="snapshot.workBacklog.providerSettings"
        :work-provider-authorization="workProviderAuthorization"
        :work-provider-authorizations="workProviderAuthorizations"
        :remote-connections="snapshot.remoteConnections.connections"
        :teams="snapshot.teams"
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
      <CockpitView
        v-else-if="cockpitVisible"
        :agents="snapshot.agents"
        :forkable-agent-ids="forkableAgentIds"
        :repository-icons="snapshot.general.repositoryIcons"
        :teams="snapshot.teams"
        :view-mode="snapshot.general.cockpitAgentViewMode"
        :response-previews="cockpitResponsePreviews"
        @add-agent="openNewAgent"
        @close-agent="$emit('close-agent', $event)"
        @duplicate-agent="$emit('duplicate-agent', $event)"
        @fork-agent="$emit('fork-agent', $event)"
        @handoff-agent="openHandoff"
        @edit-agent="openEditAgent"
        @move-agent-to-team="$emit('move-agent-to-team', $event)"
        @prompt-agent="$emit('send-agent-prompt', $event)"
        @restart-agent="$emit('restart-agent', $event)"
        @select-agent="selectAgentFromCockpit"
        @select-team="selectTeamFromRail"
        @update-view-mode="updateCockpitAgentViewMode"
      />
      <BacklogView
        v-else-if="backlogVisible"
        :agents="snapshot.agents"
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
        @select-agent="selectAgentFromCockpit"
      />
      <MissionWorkspace v-else-if="activeSurface === 'mission' && selectedMission" :key="selectedMission.id" :agents="snapshot.agents" :sidebar-collapsed="agentSidebarCollapsed || compactViewport" @expand-sidebar="expandSidebar" :mission="selectedMission" :implementation-start-progress="missionImplementationStartProgress" :read-mission-artifact="readMissionArtifact" :execute-mission="executeMission" :send-mission-prompt="forwardPrompt" :open-in-available="missionOpenInAvailable" :open-in-applications="openInApplications" @chat-about-review-finding="prepareMissionReviewDiscussion" @open-conversation="emit('select-agent', $event)" @open-worktree="openMissionWorktree">
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
          <ConversationPane v-if="currentAgent?.id === agentId" ref="missionConversationPane" :controller="conversationPaneController" :agent="currentAgent" :agents="snapshot.agents" :saved-prompt-drafts="snapshot.general.savedPromptDrafts" :save-prompt-draft="savePromptDraft" :remove-prompt-draft="removePromptDraft" :history-load-failed="props.isConversationLoadFailed" :history-loading="isConversationLoading" :has-visible-messages="conversationMessages.length > 0" :empty-headline="selectedMission.stage === 'requirements' ? t('missions.whatDoYouWantToBuild') : undefined" :empty-subhead="selectedMission.stage === 'requirements' ? '' : undefined" @retry-history="props.retryAgentHistory">
            <template v-if="selectedMission.stage === 'requirements' && conversationMessages.length === 0" #empty-actions>
              <AppMenu class="app-menu--embedded" :ariaLabel="t('missions.chooseIssue')" :items="missionSourceMenuItems" @select="openMissionIssuePicker" />
            </template>
          </ConversationPane>
        </template>
      </MissionWorkspace>
      <AgentWorkspace
        v-else
        ref="agentWorkspace"
        :active-attachment-annotation-counts="activeAttachmentAnnotationCounts"
        :add-chat-text-annotation="addChatTextAnnotation"
        :add-visualization-annotation="addFocusedVisualizationAnnotation"
        :agent-files="agentFiles"
        :agent-sidebar-collapsed="agentSidebarCollapsed || compactViewport"
        :close-right-workspace-tab="closeRightWorkspaceTab"
        :save-document-as="saveDocumentAs"
        :commit-agent-git-changes="props.commitAgentGitChanges"
        :update-plan-review="updatePlanReview"
        :respond-to-thread-flag="respondToThreadFlag"
        :thread-flag-busy="threadFlagBusy"
        :conversation-pane-controller="conversationPaneController"
        :save-prompt-draft="savePromptDraft"
        :remove-prompt-draft="removePromptDraft"
        :conversation-plan="conversationPlan"
        :chat-text-annotations="activeChatTextAnnotations"
        :visualization-annotations="activeVisualizationAnnotations"
        :review-finding-attachment="activeReviewFindingAttachment"
        :create-agent-git-pull-request="props.createAgentGitPullRequest"
        :current-agent="currentAgent"
        :empty-split-pane="!hasFocusedConversation"
        :split-headers="splitLayout !== 'single'"
        :latest-turn-id-for-agent="latestTurnIdForAgent"
        :current-agent-git-status="currentAgentGitStatus"
        :current-backend-runtime="currentBackendRuntime"
        :forward-prompt="forwardPrompt"
        :generate-agent-git-message="props.generateAgentGitMessage"
        :get-agent-git-workflow="props.getAgentGitWorkflow"
        :handle-start-work-action="handleStartWorkAction"
        :is-agent-empty="isAgentEmpty"
        :is-conversation-loading="isConversationLoading"
        :history-load-failed="isConversationLoadFailed"
        :is-loading="isLoading"
        :is-modal-dialog-visible="isModalDialogVisible"
        :is-right-workspace-visible="isRightWorkspaceVisible"
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
        :open-attachment-image-annotation="openAttachmentImageAnnotation"
        :remove-chat-text-annotation="removeChatTextAnnotation"
        :remove-visualization-annotation="removeVisualizationAnnotation"
        :open-file-preview="openFilePreview"
        :open-file-preview-for-agent="openFilePreviewForAgent"
        :open-in-applications="openInApplications"
        :open-right-workspace-tab="openRightWorkspaceTab"
        :push-agent-git-branch="props.pushAgentGitBranch"
        :right-workspace-for="rightWorkspaceFor"
        :right-workspaces="rightWorkspaces"
        :right-workspace-visible="rightWorkspaceVisible"
        :read-conversation-messages="readConversationMessages"
        :retry-conversation-history="props.retryAgentHistory"
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
        @close-agent="$emit('close-agent', $event)"
        @clarify-code-review-finding="clarifyCodeReviewFinding"
        @expand-sidebar="expandSidebar"
        @install-update="emit('install-update')"
        @remove-work-item-assignment="$emit('remove-work-item-assignment', $event)"
        @remove-review-finding-attachment="pendingReviewClarification = null"
        @send-prompt="emit('sendPrompt', $event)"
        @update:plan-mode="emit('update:planMode', $event)"
      >
        <template v-if="!compactViewport && props.agentConversationFor && props.agentConversationActions" #layout-control>
          <SplitLayoutControl :model-value="split.layout.value" @update:model-value="split.setLayout" />
        </template>
        <template v-if="splitLayout !== 'single' && props.agentConversationFor && splitActions" #conversation="{ plan, planVisible, closePlan, headerBindingsFor }">
          <AgentSplitGrid :layout="splitLayout" :panes="split.panes.value" :focused-pane-id="split.focusedPaneId.value" :ratios="split.ratios.value" @resize="split.resize" @focus="focusSplitPane">
            <template #header="{ agentId, topRight, topLeft }">
              <AgentHeader v-bind="headerBindingsFor(agentId, topRight, topLeft)" />
            </template>
            <template #default="{ agentId, focused }">
              <AgentConversationPanel v-if="props.agentConversationFor(agentId)" :key="agentId" :ref="instance => setSplitPanel(agentId, instance)"
                :view="props.agentConversationFor(agentId)!" :actions="splitActions" :agents="snapshot.agents" :focused="focused"
                :mention-groups="agentMentionGroups" :model-menu-items="splitModelFavoriteMenuItems(agentId)"
                :select-model-menu-item="item => selectSplitModelMenuItem(agentId, item)"
                :plan="focused ? plan : null" :plan-visible="planVisible" @close-plan="closePlan"
                :saved-prompt-drafts="snapshot.general.savedPromptDrafts" :save-prompt-draft="savePromptDraft" :remove-prompt-draft="removePromptDraft"
                :follow-up-behavior="snapshot.general.followUpBehavior"
                :review-finding="pendingReviewClarification?.agentId === agentId ? pendingReviewClarification.finding : null"
                :open-link="link => openSplitConversationLink(agentId, link)"
                :open-image="(image, context) => agentWorkspace?.openConversationImage(image, context, agentId) ?? false"
                :open-visualization="visualization => agentWorkspace?.openConversationVisualization(visualization, agentId)"
                @open-review="openRightWorkspaceTab('codeReview', $event)"
                @composer-command="runConversationMenuCommand"
                @remove-review-finding="pendingReviewClarification = null" />
            </template>
          </AgentSplitGrid>
        </template>
      </AgentWorkspace>
    </section>
    <RepositorySessionSourceDialog
      v-model:backend="repositorySession.backend.value"
      :visible="repositorySessionSourceVisible"
      :location="resolveRepositorySessionContext(snapshot, repositorySessionSource).location"
      :repository-name="repositorySessionSource?.repositoryName ?? ''"
      :branches="repositorySessionSourceBranches"
      :work-items="repositorySessionSourceWorkItems"
      :selected-repository-id="repositorySession.workSourceId.value"
      :loading="repositorySessionSourceLoading"
      :error="repositorySessionSourceError"
      :model-agent-id="repositorySessionSource?.agentId"
      :sessions="repositorySessionAssignmentSessions"
      @close="closeRepositorySessionSource"
      @select-branch="openNewAgentForSourceBranch"
      @custom-work-item="customizeRepositorySessionWork"
      @start-work-item="startRepositorySessionWork"
    />
    <RepositorySessionSourceDialog
      :visible="missionIssuePickerVisible"
      purpose="missionIssue"
      :location="missionIssueLocation()"
      :source-filter="acceptMissionSource"
      repository-name=""
      :loading="missionIssueLoading"
      :error="missionIssueError"
      @close="closeMissionIssuePicker"
      @select-work-item="chooseMissionIssue"
    />
    <NewSourceWorktreeDialog
      v-model:backend="repositorySession.backend.value"
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
      v-model:backend="repositorySession.backend.value"
      :visible="repositoryAcquireVisible"
      :mode="repositoryAcquireMode"
      :connection="githubConnection"
      :authorization="workProviderAuthorization"
      :repositories="repositoryAcquireRepositories"
      :local-repository-identities="repositoryAcquireSourceRepositories.flatMap((repository) => repository.remoteIdentity ? [repository.remoteIdentity] : [])"
      :loading="repositoryAcquireCatalogLoading"
      :busy="repositoryAcquireBusy"
      :error="repositoryAcquireDisplayError"
      @close="closeRepositoryAcquire"
      @clone-url="cloneRepositoryAndOpen"
      @connect="connectGitHub"
      @open-authorization="openGitHubAuthorization"
      @select-repository="selectWorkRepository"
    />
    <RemoteFolderPickerDialog
      :list-source-folders="listSourceFolders"
      :remote-connection-id="activeTeam?.remoteConnectionId ?? ''"
      :visible="repositoryAcquireRemoteFolderVisible"
      @close="closeRepositoryAcquireRemoteFolder"
      @select="selectRepositoryAcquireRemoteFolder"
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
      :blocker="agentHandoffBlocker(snapshot, handoffAgent)"
      :submit="handoffAgentAction"
      :list-models="listHandoffModels"
      :read-messages="readConversationMessages"
      @close="handoffAgentId = null"
    />
    <ModelFavoritesDialog
      :favorites="managedModelFavorites"
      :models="backendModels"
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
      :remote-connection-id="agentDialogRemoteConnectionId"
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
      :remote-connections="snapshot.remoteConnections.connections"
      :create-team="createTeam"
      :load-remote-teams="loadRemoteTeams"
      :update-team="updateTeam"
      @close="teamDialogVisible = false"
    />
    <KeyboardShortcutsDialog v-if="keyboardShortcutsVisible" :context="shortcutContext" @close="keyboardShortcutsVisible = false" />
    <CommandPalette v-if="commandPaletteVisible" :actions="paletteActions" @close="commandPaletteVisible = false" @execute="executePaletteAction" />
    <WhatsNewDialog
      :visible="whatsNewVisible"
      @close="whatsNewVisible = false"
    />
    <ImageAnnotationDialog
      :visible="imageAnnotationVisible"
      :image-src="imageAnnotationImageSource"
      :fallback-image-src="attachmentAnnotationTarget ? undefined : debugAnnotationScreenshotUrl"
      :initial-annotations="imageAnnotationInitialAnnotations"
      :initial-pixel-ratio="imageAnnotationPixelRatio"
      :file-name="imageAnnotationFileName"
      @close="closeImageAnnotation"
      @image-error="handleImageAnnotationError"
      @save="saveImageAnnotation"
    />
    <WorkspaceProvisioningProgressDialog
      :operation="provisioningProgress ? { mode: 'single', progress: provisioningProgress } : workItemCreationProgress"
      @close="closeProvisioningProgress"
    />
    <MissionDeleteDialog
      :visible="missionDeleteTarget !== null"
      :mission="missionDeleteTarget"
      :busy="missionDeletePending"
      :error="missionDeleteError"
      @close="closeMissionDeleteDialog"
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
      :agents="snapshot.agents"
      :repository-icons="snapshot.general.repositoryIcons"
      :teams="snapshot.teams"
      :unread-agent-ids="unreadAgentIds ?? []"
      @close="agentQuickOpenVisible = false"
      @select="selectAgentFromPalette"
    />
  </main>
</template>

<script setup lang="ts">
import { product } from '@workspace/core/product';

import { translate } from '../i18n';
import { localizedErrorMessage, localizedText } from '../i18n/errors';
import { ElMessage, ElMessageBox } from 'element-plus';
import { workProviderDefinition } from '@workspace/core/work-providers';
import { workProviderLabel, workItemDisplayIdentifier } from '@workspace/core/work-item-prompts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { providerUpdatePreviewKey } from './provider-update-preview';
import { codeReviewUncommittedPreviewKey } from './code-review-preview';
import { useI18n } from 'vue-i18n';
import SidebarExpandButton from '../shared/SidebarExpandButton.vue';
import { useCompactViewport } from '../shared/use-compact-viewport';
import debugAnnotationScreenshotUrl from '../../assets/debug-annotation.png?url';
import type { AgentBackend, AgentFileActivity } from '@workspace/core/contracts';
import type { AddSshConnectionInput, Agent, AgentCreationProgress, AgentFilePreviewResult, AgentFileSearchItem, AgentGitStatus, AppCommand, ApprovalPreset, AppSnapshot, BackendApprovalDecision, BackendApprovalRequest, BackendApprovalScope, BackendCapabilities, BackendCommandSummary, BackendConnectionState, BackendConversationRef, BackendPermissionModeOption, BackendModelOption, BackendPluginSummary, BackendRuntimeStatus, BackendSkillSummary, ClaudeConversationSnapshot, DaemonStatus, ClientRequestResponse, CloneSourceRepositoryInput, CockpitAgentViewMode, ConversationListInput, ConversationResumeTarget, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateProjectInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, DesktopUpdateStatus, DevicePairingSession, DevicePairingStatus, GlobalWorkItemQuery, AutomationLocation, ModelFavorite, MoveAgentToTeamInput, OpenInApplication, OpenInApplicationCatalog, PairedDevice, ReasoningEffort, RendererMessage, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, RendererSendPromptOptions, SetCodexResourceSharingInput, SidePanelRequest, SourceBranch, SourceFolderListing, SourceFolderListInput, SourceRepository, SourceWorktree, SshHostCandidate, Team, ThreadGoal, ThreadPlan, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkBacklogConfigurationInput, WorkIntegrationConnection, WorkItem, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import { defaultBackendCapabilities } from '@workspace/core/backend-capabilities';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { defaultTeamColor } from '@workspace/core/team-colors';
import { projectAgentMentionLabels } from '@workspace/core/workspace-sidebar';
import { appApi, appHostCapabilities, appClientPlatform } from '../platform-api';
import { codeReviewSettingsKey, useCodeReviewSettings } from './code-review-settings';
import AgentDialog from './AgentDialog.vue';
import WorkspaceProvisioningProgressDialog from './WorkspaceProvisioningProgressDialog.vue';
import RepositorySessionSourceDialog from './RepositorySessionSourceDialog.vue';
import { resolveRepositorySessionContext, type RepositorySessionSource } from './repository-session-context';
import NewSourceWorktreeDialog from './NewSourceWorktreeDialog.vue';
import RepositoryAcquireDialog from './RepositoryAcquireDialog.vue';
import RemoteFolderPickerDialog from './RemoteFolderPickerDialog.vue';
import NewProjectDialog from './NewProjectDialog.vue';
import { preferredBackendChoices, provideBackendChoices, provideBackendSwitch } from './backend-selection';
import CockpitView from './CockpitView.vue';
import { cockpitResponsePreview } from './cockpit-response-preview';
import BacklogView from './BacklogView.vue';
import ConversationHistoryDialog from './ConversationHistoryDialog.vue';
import AgentHandoffDialog from './AgentHandoffDialog.vue';
import { agentHandoffBlocker, type AgentHandoffInput } from '@workspace/core/agent-handoff';
import ImageAnnotationDialog from './ImageAnnotationDialog.vue';
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
import AgentConversationPanel from './AgentConversationPanel.vue';
import SplitLayoutControl from './SplitLayoutControl.vue';
import { useSplitWorkspace } from './use-split-workspace';
import type { AgentConversationActions } from './use-agent-conversation';
import { conversationCommandMenuItems, conversationMenuCommand, type ConversationMenuCommand } from './conversation-command-menu';
import { claudePaneClientRequests } from './claude-pane-client-requests';
import { antigravityPaneClientRequests } from './antigravity-pane-client-requests';
import { backendDisplayName } from '@workspace/core/backend-driver';
import type { AgentConversationView } from '../app-state';
import MissionCodeReview from './MissionCodeReview.vue';
import MissionShipBoard from './MissionShipBoard.vue';
import MissionWorkspace from './MissionWorkspace.vue';
import MissionDeleteDialog from './MissionDeleteDialog.vue';
import type { MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';
import ConversationPane from './ConversationPane.vue';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { Mission, CreateMissionInput, DeleteMissionInput } from '@workspace/core/missions';
import type { MissionImplementationStartProgress } from '@workspace/core/mission-execution';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import SettingsView from './SettingsView.vue';
import FirstRunOnboardingGate from './FirstRunOnboardingGate.vue';
import CodexResourceSharingMigrationDialog from './CodexResourceSharingMigrationDialog.vue';
import ModelFavoritesDialog from './ModelFavoritesDialog.vue';
import type { SettingsTab } from './settings-tabs';
import {
  createCodexConversationPaneController,
  type CodexCapabilities,
  type CodexConversationLink,
  type CodexConversationPaneActions,
  type CodexConversationPaneState,
  type CodexConversationVisualization,
  type CodexComposerMenuItem,
  type CodexComposerMentionGroup,
  type CodexMessageImage,
  type CodexMessageImageContext,
  type CodexNativeAttachment,
  type CodexComposerState,
  type CodexQueuedPromptData as QueuedChatPrompt,
  type CodexRendererSendMessageOptions,
} from '@codex-app-sdk/vue';
import type { CodexConversationSnapshot, SurfaceMessage } from '@codex-app-sdk/core/surface';
import type { ThreadFlagResponse } from '@workspace/core/thread-flags';
import { BacklogIcon, BoltIcon, PencilIcon, PlusIcon, ShieldCheckIcon } from '../shared/icons/app-icons';
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
import type { RightWorkspaceTab } from './right-workspace';
import { useImageAnnotation } from './use-image-annotation';
import { useChatTextAnnotations } from './use-chat-text-annotations';
import { useVisualizationAnnotations } from './use-visualization-annotations';
import { useCockpitBacklog } from './use-cockpit-backlog';
import { provideBacklogConnections } from './backlog-providers';
import { useWorkspacePreviews } from './use-workspace-previews';
import { downloadAgentFile } from '../download-agent-file';
import { useWorkItemRouting } from './use-work-item-routing';
import { useAppShellCommands } from './use-app-shell-commands';

const props = withDefaults(defineProps<{
  snapshot: AppSnapshot;
  activeAgent: Agent | null;
  unreadAgentIds?: string[];
  agentFiles?: AgentFileSearchItem[];
  isLoading: boolean;
  isConversationLoading?: boolean;
  isConversationLoadFailed?: boolean;
  historyHasOlder?: boolean;
  historyLoadingOlder?: boolean;
  isSending: boolean;
  connectionState?: BackendConnectionState;
  goal?: ThreadGoal | null;
  approvals?: BackendApprovalRequest[];
  approvalPreset?: ApprovalPreset | null;
  permissionMode?: string | null;
  answeredClientRequestIds?: Set<string>;
  backendModels?: BackendModelOption[];
  backendCommands?: BackendCommandSummary[];
  backendPlugins?: BackendPluginSummary[];
  backendSkills?: BackendSkillSummary[];
  backendCapabilities?: BackendCapabilities;
  codexConversationSnapshot?: CodexConversationSnapshot | null;
  claudeConversationSnapshot?: ClaudeConversationSnapshot | null;
  antigravityConversationSnapshot?: import('@workspace/core/contracts/antigravity-conversation').AntigravityConversationSnapshot | null;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedServiceTier?: string | null;
  planMode?: boolean;
  queuedPrompts?: QueuedChatPrompt[];
  composerState?: CodexComposerState;
  composerAttachments?: readonly CodexNativeAttachment[];
  updateStatus?: DesktopUpdateStatus;
  sidePanelRequest?: SidePanelRequest | null;
  markdownDisplayRequests?: Array<Extract<SidePanelRequest, { kind: 'markdown' }>>;
  fileActivity?: AgentFileActivity | null;
  workProviderAuthorization?: WorkProviderAuthorization | null;
  workProviderAuthorizations?: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  workRepositoriesByProvider?: Partial<Record<WorkProviderKind, WorkSource[]>>;
  workItemsByRepository?: Record<string, WorkItem[]>;
  assignedWorkItemsByProvider?: Partial<Record<WorkProviderKind, WorkItem[]>>;
  workBacklogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  workBacklogError?: string | null;
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
  getAgentGitWorkflow?: (agentId: string) => Promise<import('@workspace/core/contracts').AgentGitWorkflow>;
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
  createAgent?: (input: CreateAgentInput) => Promise<Agent | null | void>;
  createMission?: (input: CreateMissionInput) => Promise<Mission>;
  selectMission?: (missionId: string | null) => Promise<void>;
  deleteMission?: (input: DeleteMissionInput) => Promise<void>;
  readMissionArtifact?: (missionId: string, stage: import('@workspace/core/missions').MissionStage) => Promise<import('@workspace/core/mission-execution').MissionArtifactReadResult>;
  executeMission?: (input: import('@workspace/core/mission-execution').MissionExecutionInput) => Promise<void>;
  missionImplementationStartProgress?: MissionImplementationStartProgress | null;
  createQuickChat?: (input: CreateQuickChatInput) => Promise<Agent | null | void>;
  createTeam?: (input: CreateTeamInput) => Promise<Team | null | void>;
  updateTeam?: (input: UpdateTeamInput) => Promise<void>;
  updateAgent?: (input: UpdateAgentInput) => Promise<void>;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
  setCodexResourceSharing?: (input: SetCodexResourceSharingInput) => Promise<void>;
  getPluginStatus?: () => Promise<import('@workspace/core/contracts').AppPluginStatus>;
  listSshHosts?: () => Promise<SshHostCandidate[]>;
  addSshConnection?: (input: AddSshConnectionInput) => Promise<void>;
  checkRemoteConnection?: (connectionId: string, inspectOnly?: boolean) => Promise<void>;
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
  readConversationMessages?: (ref: BackendConversationRef, agentId: string, location?: AutomationLocation) => Promise<RendererMessage[]>;
  connectWorkProvider?: (provider: WorkProviderKind) => Promise<void>;
  openWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  pollWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  disconnectWorkProvider?: (provider: WorkProviderKind) => Promise<void>;
  configureWorkBacklog?: (input: WorkBacklogConfigurationInput) => Promise<void>;
  loadWorkRepositories?: (provider: WorkProviderKind, location?: AutomationLocation) => Promise<WorkSource[] | void>;
  loadWorkItems?: (provider: WorkProviderKind, repositoryId: string, location?: AutomationLocation, query?: WorkItemQuery) => Promise<WorkItem[] | void>;
  loadGlobalWorkItems?: (provider: WorkProviderKind, location?: AutomationLocation, query?: GlobalWorkItemQuery) => Promise<WorkItemPage>;
  loadAssignedWorkItems?: (provider: WorkProviderKind, location?: AutomationLocation) => Promise<WorkItem[] | void>;
  duplicateAgentAction?: (agentId: string, options?: import('@workspace/core/contracts').DuplicateAgentOptions) => Promise<Agent | null>;
  assignWorkItemAction?: (payload: { agentId: string; item: WorkItem; prompt?: string }) => Promise<void>;
  loadOlderAgentHistory?: (agentId: string) => Promise<void>;
  retryAgentHistory?: () => Promise<void>;
  agentConversationFor?: (agentId: string) => AgentConversationView | null;
  agentConversationActions?: AgentConversationActions;
  sendPromptAction?: (prompt: string, options?: RendererSendPromptOptions) => Promise<void>;
  updatePlanReview?: (agentId: string, response: import('@workspace/core/plan-review').PlanReviewResponse) => Promise<import('@workspace/core/plan-review').PlanReview>;
  respondToThreadFlagAction?: (response: ThreadFlagResponse) => Promise<void>;
  deleteTurnAction?: (turnId: string) => Promise<void>;
  editTurnAction?: (payload: { content: string; turnId: string }) => Promise<void>;
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
  backendModels: () => [],
  backendCommands: () => [],
  backendPlugins: () => [],
  backendSkills: () => [],
  backendCapabilities: () => defaultBackendCapabilities('codex'),
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
  approvalPreset: null,
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
  deleteMission: async () => { throw new Error('Missions unavailable.'); },
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
  'consume-markdown-displays': [count: number];
  'close-team': [teamId: string];
  'disconnect-team': [teamId: string];
  'close-agent': [agentId: string];
  'compress-session': [agentId: string];
  'cleanup-pull-request': [agentId: string];
  'clear-goal': [];
  'client-response': [response: ClientRequestResponse];
  'delete-turn': [turnId: string];
  'delete-queued-prompt': [promptId: string];
  'debug-mark-unread': [];
  'duplicate-agent': [agentId: string];
  'fork-agent': [agentId: string];
  'fork-turn': [turnId: string];
  'edit-turn': [payload: { content: string; turnId: string }];
  'interrupt-agent': [];
  'move-agent-to-team': [input: MoveAgentToTeamInput];
  'reorder-agents': [input: ReorderAgentsInput];
  'reorder-repositories': [input: ReorderRepositoriesInput];
  'reorder-teams': [input: ReorderTeamsInput];
  'assign-work-item': [payload: { agentId: string; item: WorkItem }];
  'remove-work-item-assignment': [item: WorkItem];
  'restart-agent': [agentId: string];
  'resolve-approval': [approvalId: string, decision: BackendApprovalDecision, scope: BackendApprovalScope];
  'retry-turn': [turnId: string];
  'send-agent-prompt': [payload: { agentId: string; prompt: string }];
  'select-agent': [agentId: string];
  'select-model': [modelId: string];
  'select-reasoning-effort': [reasoningEffort: ReasoningEffort];
  'select-service-tier': [serviceTier: string | null];
  'select-approval-preset': [preset: ApprovalPreset];
  'select-permission-mode': [mode: string];
  'select-team': [teamId: string];
  'steer-queued-prompt': [promptId: string, prompt?: string];
  'update-queued-prompt': [promptId: string, prompt: string];
  'update:planMode': [enabled: boolean];
  'update:composerState': [payload: { agentId: string; state: CodexComposerState }];
  'update:composerAttachments': [payload: { agentId: string; attachments: readonly CodexNativeAttachment[] }];
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

type AppSurface = 'mission' | 'agent' | 'cockpit' | 'backlog' | 'automations' | 'settings';
provideBackendChoices(() => props.snapshot, openSettings);
const reviewSettings = useCodeReviewSettings();
provide(codeReviewSettingsKey, { ...reviewSettings, preferences: () => props.snapshot.general.codeReviewDefaults });
provideBacklogConnections(() => props.snapshot.workBacklog.connections);
const backendSwitch = provideBackendSwitch((id, backend) => props.updateAgent({ id, backend }));
const agentSidebarCollapsed = ref(false);
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
const missionConversationPane = ref<{ focusComposer(): void; openSavedDraftPicker(): void; saveCurrentDraft(): Promise<void> } | null>(null);
const activeReviewFindingAttachment = computed(() => {
  const clarification = pendingReviewClarification.value;
  return clarification && clarification.agentId === currentAgent.value?.id
    ? clarification.finding
    : null;
});
const codexResourceSharingMigrationPending = ref(false);
const agentListCompact = computed(() => props.snapshot.general.agentListCompact);
const codexResourceSharingBlocked = computed(() => props.snapshot.agents.some((agent) => (
  agent.status.type === 'working' ||
  agent.status.type === 'awaitingInput'
)));
const agentSidebarMinWidth = 200;
const agentSidebarMaxWidth = 420;
const agentSidebarWidth = ref(260);
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
const activeSurface = ref<AppSurface>('agent');
const missionCreationError = ref('');
const missionCreationPending = ref(false);
const missionDeleteTargetId = ref<string | null>(null);
const missionDeletePending = ref(false);
const missionDeleteError = ref('');
const selectedMissionId = ref<string | null>(null);
const selectedMission = computed(() => props.snapshot.missions?.find(m => m.id === selectedMissionId.value) ?? null);
const missionIssuePickerVisible = ref(false);
const missionIssueLoading = ref(false);
const missionIssueError = ref<string | null>(null);
const missionSourceMenuItems = computed(() => [{ id: 'issue', type: 'action' as const, label: t('missions.chooseIssue'), icon: BacklogIcon }]);

function missionIssueLocation(): AutomationLocation | undefined {
  const team = props.snapshot.teams.find(candidate => candidate.id === selectedMission.value?.teamId);
  return team?.remoteConnectionId ? { kind: 'remote', remoteConnectionId: team.remoteConnectionId } : undefined;
}

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
  const team = props.snapshot.teams.find(candidate => candidate.id === mission.teamId);
  return !!team && !team.remoteConnectionId;
});
function openMissionWorktree(request: MissionWorkspaceOpenRequest): void {
  void openAgentIn(request.agentId, request.application, request.path);
}
const missionDeleteTarget = computed(() => props.snapshot.missions?.find(m => m.id === missionDeleteTargetId.value) ?? null);
function selectMissionSurface(id: string): void {
  selectedMissionId.value = id;
  activeSurface.value = 'mission';
}
watch(
  () => activeSurface.value === 'mission' ? selectedMissionId.value : null,
  missionId => { closeMissionIssuePicker(); rememberMissionId(missionId); void props.selectMission(missionId); },
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
  if (!props.snapshot.missions?.some(mission => mission.id === id && mission.teamId === activeTeam.value?.id)) return;
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

function deleteMissionFromSidebar(id: string): void {
  if (!props.snapshot.missions?.some(candidate => candidate.id === id)) return;
  missionDeleteTargetId.value = id;
  missionDeleteError.value = '';
}

function closeMissionDeleteDialog(): void {
  if (missionDeletePending.value) return;
  missionDeleteTargetId.value = null;
  missionDeleteError.value = '';
}

async function confirmMissionDeletion(deleteWorktrees: boolean): Promise<void> {
  const mission = missionDeleteTarget.value;
  if (!mission || missionDeletePending.value) return;
  missionDeletePending.value = true;
  missionDeleteError.value = '';
  try {
    await props.deleteMission({ id: mission.id, revision: mission.revision, deleteWorktrees, confirmed: true });
    if (selectedMissionId.value === mission.id) {
      selectedMissionId.value = null;
      activeSurface.value = 'agent';
    }
    missionDeleteTargetId.value = null;
  } catch (error) {
    missionDeleteError.value = localizedErrorMessage(error, t);
  } finally {
    missionDeletePending.value = false;
  }
}
const fileQuickOpenVisible = ref(false);
const agentQuickOpenVisible = ref(false);
const debugApproval = ref<{ agentId: string; request: BackendApprovalRequest } | null>(null);
const debugUserQuestions = ref<{ agentId: string; message: SurfaceMessage; requestId: string } | null>(null);
const debugAgentCreationProgress = ref<AgentCreationProgress | null>(null);
const debugAgentCreationTimers: Array<ReturnType<typeof setTimeout>> = [];
const agentWorkspace = ref<{
  getCommandActions(): CommandPaletteAction[];
  openRightWorkspaceTabFromMenu(agentId: string, tab: RightWorkspaceTab): void;
  focusComposer(): void;
  openSavedDraftPicker(): void;
  saveCurrentDraft(): void;
  handleBrowserOpenCommand(command: Extract<AppCommand, { type: 'open-browser' }>): void;
  openConversationLink(link: CodexConversationLink): void | Promise<void>;
  openConversationImage(image: CodexMessageImage, context?: CodexMessageImageContext, agentId?: string): boolean;
  openConversationVisualization(visualization: CodexConversationVisualization, agentId?: string): void;
  showDebugGitOperationProgress(operation: 'pullRequest' | 'merge'): void | Promise<void>;
  workspaceBodyElement(): HTMLElement | null;
} | null>(null);
const settingsActiveTab = ref<SettingsTab>('general');
const agentDialogVisible = ref(false);
const modelFavoritesDialogVisible = ref(false);
const newProjectDialogVisible = ref(false);
const newProjectBusy = ref(false);
const newProjectError = ref<string | null>(null);
const modelFavoritesDialogBackend = ref<ModelFavorite['backend'] | null>(null);
const resumeSessionAgentId = ref<string | null>(null);
const handoffAgentId = ref<string | null>(null);
const handoffAgent = computed(() => props.snapshot.agents.find(agent => agent.id === handoffAgentId.value) ?? null);
function openHandoff(agentId: string) { handoffAgentId.value = agentId; }
async function listHandoffModels(agentId: string, backend: AgentBackend) {
  return await appApi?.listBackendModels(agentId, backend) ?? [];
}
const agentDialogMode = ref<'create' | 'edit'>('create');
const editingAgentId = ref<string | null>(null);
const agentDialogTeamId = ref<string | null>(null);
const agentDialogSourceRepositoryName = ref<string | null>(null);
const agentDialogSourceBranchName = ref('');
const githubConnection = computed<WorkIntegrationConnection>(() => (
  props.snapshot.workBacklog.connections.find((connection) => connection.provider === 'github') ?? {
    provider: 'github',
    status: 'disconnected',
  }
));
const firstRunOnboarding = useFirstRunOnboarding({
  getApi: () => appApi,
  getConnections: () => props.snapshot.providerConnections ?? [],
  hasExistingWorkspace: () => props.snapshot.agents.length > 0 || props.snapshot.general.providerOnboardingComplete === true,
  isGitHubConnected: () => githubConnection.value.status === 'connected' && githubConnection.value.source !== 'cli',
});
const {
  claudeAuthentication, claudeConnected, claudeLoading, claudeError, claudeDialogVisible,
  antigravityConnected, antigravityLoading, antigravityPending, antigravityError, connectAntigravity, cancelAntigravityLogin,
  providerSetup, customizedSetup, customizingProvider, setupBusy, updatingProvider, setupError, customizeProvider, saveProviderSetup, installProvider: installRealProvider, refreshProvider: refreshRealProvider,
  codexConnected, continuing, connectClaude, disconnectProvider, refreshClaude, continueWithProviders,
  authentication,
  authenticationCancelling,
  authenticationError,
  authenticationLoading,
  completeVisible: onboardingCompleteVisible,
  gated: realOnboardingGate,
  githubVisible: githubOnboardingVisible,
  initialAuthenticationLoading,
  showLogin: realLoginLanding,
  cancelChatGptLogin,
  finish: finishFirstRunOnboarding,
  load: loadAuthentication,
  startChatGptLogin,
} = firstRunOnboarding;
// Debug previews project display state only; onboarding and live agents retain real connections.
const debugMissingEngines = ref(false);
const debugProviderUpgrades = ref(false);
provide(providerUpdatePreviewKey, debugProviderUpgrades);
const debugReviewUncommitted = ref(false);
provide(codeReviewUncommittedPreviewKey, debugReviewUncommitted);
const showOnboardingGate = computed(() => debugMissingEngines.value ? !settingsVisible.value : realOnboardingGate.value);
const showLoginLanding = computed(() => debugMissingEngines.value ? !settingsVisible.value : realLoginLanding.value);
const displayProviderSetup = computed(() => debugMissingEngines.value
  ? providerSetup.value.map(setup => ({ ...setup, installed: false }))
  : providerSetup.value);
const displayProviderConnections = computed(() => debugMissingEngines.value
  ? props.snapshot.providerConnections?.map(engine => ({ ...engine, installed: false, connected: false, checking: false, authentication: undefined, error: undefined }))
  : props.snapshot.providerConnections);
async function installProvider(backend: AgentBackend): Promise<void> {
  if (!debugMissingEngines.value) await installRealProvider(backend);
}
async function refreshProvider(backend: AgentBackend): Promise<void> {
  if (!debugMissingEngines.value) await refreshRealProvider(backend);
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
watch([selectedMission, activeTeam], ([mission, team], [previousMission]) => {
  if (activeSurface.value === 'mission' && ((previousMission && !mission) || (mission && mission.teamId !== team?.id))) {
    selectedMissionId.value = null;
    activeSurface.value = 'agent';
  }
});
watch(() => props.connectionState.status, (status) => {
  if (status !== 'connected' || !pendingMissionRestoreId) return;
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
  createAgent: (input) => props.createAgent(input),
  createIsolatedWorkItemAgent,
  createSourceWorktree: (input) => props.createSourceWorktree(input),
  getSnapshot: () => props.snapshot,
  getWorkRepositories: () => props.workRepositoriesByProvider.github ?? [],
  listSourceBranches: (repoPath, remoteConnectionId) => props.listSourceBranches(repoPath, remoteConnectionId),
  loadWorkItems: async (repositoryId, location) => await props.loadWorkItems(
    'github',
    repositoryId,
    location,
    { kind: 'all', state: 'open' },
  ) ?? [],
  loadWorkRepositories: async (location) => await props.loadWorkRepositories('github', location) ?? [],
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
const repositoryAcquisition = useRepositoryAcquisition({
  activeTeam: () => activeTeam.value,
  activeTeamId: () => props.snapshot.activeTeamId ?? undefined,
  catalog: () => props.workRepositoriesByProvider.github,
  catalogError: () => props.workBacklogError,
  catalogStatus: () => props.workBacklogStatus,
  chooseLocalFolder: () => props.chooseAgentFolder(),
  cloneRepository: (input) => props.cloneSourceRepository(input),
  connectGitHub: () => props.connectWorkProvider('github'),
  errorMessage: (error) => localizedErrorMessage(error, t),
  githubConnection: () => githubConnection.value,
  listSourceRepositories: (remoteConnectionId) => props.listSourceRepositories(remoteConnectionId),
  loadGitHubRepositories: () => props.loadWorkRepositories('github'),
  openFolder: async (folder, teamId) => {
    const backend = preferredBackendChoices(props.snapshot, teamId)[0];
    if (!backend) { openSettings(); return; }
    await props.createAgent({
      name: null,
      folder,
      backend,
      ...(teamId ? { teamId } : {}),
    });
  },
  openGitHubAuthorization: () => props.openWorkProviderAuthorization('github'),
  openRepository: (repository, teamId) => openRepositorySessionSource({
    teamId,
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
  closeRemoteFolderPicker: closeRepositoryAcquireRemoteFolder,
  connect: connectGitHub,
  displayError: repositoryAcquireDisplayError,
  error: repositoryAcquireError,
  mode: repositoryAcquireMode,
  open: openRepositoryAcquire,
  openAuthorization: openGitHubAuthorization,
  openExistingFolder: openExistingRepositoryFolder,
  remoteFolderPickerVisible: repositoryAcquireRemoteFolderVisible,
  repositories: repositoryAcquireRepositories,
  select: selectWorkRepository,
  selectRemoteFolder: selectRepositoryAcquireRemoteFolder,
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
const agentMentionGroups = computed<readonly CodexComposerMentionGroup[]>(() => {
  if (activeTeamAgents.value.length === 0) return [];
  return [{
    id: 'agents',
    label: translate('surface.appShell.agents'),
    placement: 'before',
    items: projectAgentMentionLabels(activeTeamAgents.value, t('sidebar.quickChats')).map(({ agentId, label }) => ({
      id: agentId,
      value: `agent:${agentId}`,
      label,
      payload: { agentId },
    })),
  }];
});
const unreadTeamIds = computed(() => {
  const unreadAgentIdSet = new Set(props.unreadAgentIds);
  return props.snapshot.teams
    .filter((team) => (
      (activeSurface.value !== 'agent' || team.id !== activeTeam.value?.id)
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
    const defaults = defaultBackendCapabilities(agent.backend);
    const runtime = props.snapshot.backendRuntimes.find((candidate) => candidate.backend === agent.backend);
    return (runtime?.capabilities?.conversationFork ?? defaults.conversationFork) === true;
  })
  .map((agent) => agent.id));
const summaryReplacementAgentIds = computed(() => props.snapshot.agents
  .filter((agent) => {
    const runtime = props.snapshot.backendRuntimes.find((candidate) => candidate.backend === agent.backend);
    return (runtime?.capabilities?.conversationReplaceWithSummary ?? defaultBackendCapabilities(agent.backend).conversationReplaceWithSummary) === true;
  }).map((agent) => agent.id));
const currentAgent = computed(() => {
  const team = activeTeam.value;
  if (!team) {
    return null;
  }

  if (props.activeAgent && team.agentIds.includes(props.activeAgent.id)) {
    return props.activeAgent;
  }

  return activeTeamAgents.value.find((agent) => agent.id === team.activeAgentId) ?? activeTeamAgents.value[0] ?? null;
});
watch(
  [compactViewport, activeSurface],
  ([compact, surface]) => {
    if (compact && surface !== 'agent' && surface !== 'cockpit') activeSurface.value = 'agent';
  },
  { immediate: true },
);
// Getter-per-source: a getter returning a fresh array would fire on every snapshot update.
watch(
  [compactViewport, () => currentAgent.value?.id, activeSurface, selectedMissionId],
  ([compact]) => { if (!compact || compactNavOpen.value) compactNavOpen.value = false; },
);
watch(() => currentAgent.value?.id, (agentId) => {
  if (pendingReviewClarification.value && pendingReviewClarification.value.agentId !== agentId) {
    pendingReviewClarification.value = null;
  }
});
const split = useSplitWorkspace({
  agentIds: () => activeTeamAgents.value.map(agent => agent.id),
  currentAgentId: () => currentAgent.value?.id,
  teamId: () => activeTeam.value?.id,
  selectAgent: id => emit('select-agent', id),
});
// Compact screens display one conversation without changing the saved team layout.
const splitLayout = computed(() => compactViewport.value ? 'single' : split.layout.value);
const hasFocusedConversation = computed(() => compactViewport.value || Boolean(split.focusedPane.value.agentId));
const rightWorkspaceState = useRightWorkspaceState({
  currentAgentId: () => currentAgent.value?.id,
  sharedVisibilityGroupId: () => splitLayout.value === 'single' ? undefined : activeTeam.value?.id,
  workspaceBody: () => agentWorkspace.value?.workspaceBodyElement() ?? null,
});
const documentWorkspaces = useDocumentWorkspaces({
  api: appApi,
  workspaces: rightWorkspaceState.workspaces,
  workspaceFor: rightWorkspaceState.workspaceFor,
  reportError: message => ElMessage.error(message),
});
const saveDocumentAs = useDocumentSaveAs({
  snapshot: () => props.snapshot,
  workspaceFor: rightWorkspaceState.workspaceFor,
  save: documentWorkspaces.save,
});
const splitPanels = new Map<string, InstanceType<typeof AgentConversationPanel>>();
function setSplitPanel(agentId: string, instance: unknown): void {
  if (instance) splitPanels.set(agentId, instance as InstanceType<typeof AgentConversationPanel>);
  else splitPanels.delete(agentId);
}
function focusedConversationPanel() {
  return splitLayout.value === 'single' ? agentWorkspace.value : splitPanels.get(split.focusedPane.value.agentId ?? '');
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
      ? view.history.hydrating || (view.codexSnapshot ?? view.claudeSnapshot)?.historyLoading
      : props.isConversationLoading;
  },
], ([requestedId, activeId, loading]) => {
  if (!requestedId || requestedId !== activeId || loading) return;
  void nextTick(() => {
    if (pendingComposerFocusAgentId.value !== requestedId || currentAgent.value?.id !== requestedId) return;
    pendingComposerFocusAgentId.value = null;
    if (activeSurface.value === 'agent' && !isModalDialogVisible.value) focusedConversationPanel()?.focusComposer();
  });
}, { flush: 'post' });
function addFocusedVisualizationAnnotation(annotation: import('./use-visualization-annotations').VisualizationAnnotationInput): void {
  if (splitLayout.value === 'single') addVisualizationAnnotation(annotation);
  else splitPanels.get(currentAgent.value?.id ?? '')?.addVisualizationAnnotation(annotation);
}
const splitActions = computed<AgentConversationActions | undefined>(() => props.agentConversationActions ? {
  ...props.agentConversationActions,
  send: async (agentId, prompt, options) => {
    await backendSwitch.settled();
    const visualize = prompt.match(/^\/visualize(?:\s+([\s\S]*))?$/u);
    if (visualize && !options?.attachments?.length) {
      return startVisualizeForAgent(agentId, visualize[1]?.trim() ? { prompt: visualize[1].trim() } : undefined);
    }
    const review = prompt.trim().match(/^\/review(?:\s+([\s\S]*))?$/u);
    if (review && !options?.attachments?.length) return openCodeReviewForAgent(agentId, review[1]?.trim());
    const clarification = pendingReviewClarification.value;
    if (clarification?.agentId === agentId && !options?.attachments?.length) {
      await props.discussCodeReviewFinding(agentId, { sessionId: clarification.sessionId, roundId: clarification.roundId, findingId: clarification.findingId, question: prompt });
      if (pendingReviewClarification.value === clarification) pendingReviewClarification.value = null;
      return;
    }
    return props.agentConversationActions?.send(agentId, prompt, options);
  },
} : undefined);
function openSplitConversationLink(agentId: string, link: CodexConversationLink): void | Promise<void> {
  if (link.kind === 'external') { window.open(link.href, '_blank', 'noopener,noreferrer'); return; }
  return workspacePreviews.openConversationFile({ ...link, kind: 'file' }, agentId);
}
const {
  closeTab: closeRightWorkspaceTabLocal,
  isVisible: isRightWorkspaceVisible,
  openTab: openRightWorkspaceTabLocal,
  rightWorkspaceVisible,
  resizing: rightWorkspaceResizing,
  selectTab: selectRightWorkspaceTab,
  startResize: startRightWorkspaceResize,
  toggle: toggleRightWorkspace,
  toggleFiles: toggleFileExplorer,
  workspaceFor: rightWorkspaceFor,
  workspaces: rightWorkspaces,
} = rightWorkspaceState;

function openRightWorkspaceTab(tab: RightWorkspaceTab, agentId?: string): void {
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
  const visualize = props.snapshot.agents.find(agent => agent.id === agentId)?.visualize;
  if (tab === 'visualize' && visualize?.isOpen) {
    void props.setVisualizeOpen(agentId, { open: false }).catch(error => {
      openRightWorkspaceTabLocal('visualize', agentId);
      ElMessage.error(localizedErrorMessage(error, t));
    });
  }
}

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
const workspacePreviews = useWorkspacePreviews({
  downloadAgentFile,
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
const {
  handleFileActivity,
  openAgentGitDiff: openAgentGitDiffForAgent,
  openConversationFile: openFilePreview,
  openFile: openFilePreviewForAgent,
  openMarkdown: openMarkdownRequest,
  openSidePanel: openSidePanelRequest,
} = workspacePreviews;
function openAgentGitDiffPreview(agentId = currentAgent.value?.id, target?: import('@workspace/core/contracts').AgentGitDiffTarget): Promise<void> {
  return agentId ? openAgentGitDiffForAgent(agentId, target) : Promise.resolve();
}
const imageAnnotation = useImageAnnotation({
  composerAttachments: () => props.composerAttachments,
  composerState: () => props.composerState,
  currentAgentId: () => currentAgent.value?.id,
  debugFallbackImageSource: debugAnnotationScreenshotUrl,
  notifyError: (message) => ElMessage.error(message),
  updateComposerAttachments: (agentId, attachments) => {
    emit('update:composerAttachments', { agentId, attachments });
  },
  updateComposerState: (agentId, state) => {
    emit('update:composerState', { agentId, state });
  },
});
const {
  activeCounts: activeAttachmentAnnotationCounts,
  close: closeImageAnnotation,
  fileName: imageAnnotationFileName,
  forward: forwardCodexPromptWithImageAnnotations,
  handleError: handleImageAnnotationError,
  imageSource: imageAnnotationImageSource,
  initialAnnotations: imageAnnotationInitialAnnotations,
  openAttachment: openAttachmentImageAnnotation,
  openDebug: openDebugImageAnnotation,
  pixelRatio: imageAnnotationPixelRatio,
  prune: pruneSavedImageAnnotations,
  save: saveImageAnnotation,
  target: attachmentAnnotationTarget,
  visible: imageAnnotationVisible,
} = imageAnnotation;
const chatTextAnnotation = useChatTextAnnotations({
  currentAgentId: () => currentAgent.value?.id,
});
const {
  activeAnnotations: activeChatTextAnnotations,
  add: addChatTextAnnotation,
  forward: forwardCodexPromptWithChatTextAnnotations,
  remove: removeChatTextAnnotation,
} = chatTextAnnotation;
const visualizationAnnotation = useVisualizationAnnotations({
  currentAgentId: () => currentAgent.value?.id,
});
const {
  activeAnnotations: activeVisualizationAnnotations,
  add: addVisualizationAnnotation,
  forward: forwardCodexPromptWithVisualizationAnnotations,
  remove: removeVisualizationAnnotation,
} = visualizationAnnotation;
const cockpitBacklogState = useCockpitBacklog({
  configure: (input) => props.configureWorkBacklog(input),
  confirmLoadAll: async () => {
    try {
      await ElMessageBox.confirm(
        translate('surface.appShell.thisLoadsYourGlobalGitHubBacklogOnePageAtATimeLargeBackl'),
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
  getWorkBacklogError: () => props.workBacklogError,
  getWorkBacklogStatus: () => props.workBacklogStatus,
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
const effectiveApprovals = computed(() => {
  const fixture = debugApproval.value;
  const providerApprovals = currentAgent.value?.backend === 'codex'
    ? props.codexConversationSnapshot?.approvals ?? []
    : props.approvals ?? [];
  return [
    ...providerApprovals,
    ...(fixture && fixture.agentId === currentAgent.value?.id ? [fixture.request] : []),
  ];
});
const currentBackendRuntime = computed<BackendRuntimeStatus>(() => {
  const backend = currentAgent.value?.backend ?? 'codex';
  return props.snapshot.backendRuntimes.find((runtime) => runtime.backend === backend) ?? {
    backend,
    status: 'notConfigured',
  };
});
const currentAgentGitStatus = computed<AgentGitStatus | null>(() => {
  const agentId = currentAgent.value?.id;
  return agentId ? props.snapshot.agentGitStatuses[agentId] ?? null : null;
});
const conversationKey = computed(() => {
  const session = currentAgent.value?.backendSession;
  if (session?.kind === 'codex') return `codex:${session.threadId}`;
  if (session) return `${session.kind}:${session.sessionId}`;
  return currentAgent.value ? `agent:${currentAgent.value.id}` : 'no-agent';
});
const providerConversation = computed(() => (
  currentAgent.value?.backend === 'codex'
    ? props.codexConversationSnapshot ?? null
    : currentAgent.value?.backend === 'claude'
      ? props.claudeConversationSnapshot ?? null
      : currentAgent.value?.backend === 'antigravity' ? props.antigravityConversationSnapshot ?? null : null
));
const conversationMessages = computed(() => {
  const messages = providerConversation.value?.messages ?? [];
  const fixture = debugUserQuestions.value;
  if (!fixture || fixture.agentId !== currentAgent.value?.id) return messages;
  return [...messages, fixture.message];
});
const conversationLatestTurnId = computed(() => providerConversation.value?.turns.at(-1)?.id ?? null);
function latestTurnIdForAgent(agentId: string): string | null {
  const view = props.agentConversationFor?.(agentId);
  return (view?.codexSnapshot ?? view?.claudeSnapshot)?.turnIds.at(-1) ?? null;
}
const conversationHasRunningPlanTool = computed(() => conversationMessages.value.some(
  (message) => message.parts.some(
    (part) => part.type === 'tool' && part.status === 'running' && part.metadata?.planProgress === true,
  ),
));
const codexConversationPlan = computed<ThreadPlan | null>(() => {
  const providerSnapshot = props.codexConversationSnapshot;
  const executionPlan = providerSnapshot?.executionPlan;
  if (!providerSnapshot || !executionPlan) return null;
  return {
    threadId: providerSnapshot.activeConversationId,
    turnId: executionPlan.turnId,
    kind: 'execution',
    status: executionPlan.steps.length > 0
      && executionPlan.steps.every((step) => step.status === 'completed')
      ? 'completed'
      : 'inProgress',
    explanation: executionPlan.explanation ?? '',
    steps: executionPlan.steps.map((step) => ({ ...step })),
    markdown: executionPlan.markdown,
    updatedAt: executionPlan.updatedAt,
  };
});
const conversationPlan = computed(() => (
  currentAgent.value?.backend === 'claude'
    ? props.claudeConversationSnapshot?.plan ?? null
    : codexConversationPlan.value ?? currentAgent.value?.plan ?? null
));
const conversationActiveTurnId = computed(() => {
  if (providerConversation.value) return providerConversation.value.activeTurnId;
  if (currentAgent.value?.backend === 'codex') return null;
  if (!props.isSending) return null;
  for (let index = conversationMessages.value.length - 1; index >= 0; index -= 1) {
    const turnId = conversationMessages.value[index]?.turnId;
    if (turnId) return turnId;
  }
  return null;
});
const conversationCapabilities = computed<CodexCapabilities>(() => ({
  models: props.backendCapabilities.models,
  skills: props.backendCapabilities.skills,
  reasoningEffort: props.backendCapabilities.reasoningEffort,
  ...(props.backendCapabilities.serviceTier === undefined
    ? {}
    : { serviceTier: props.backendCapabilities.serviceTier }),
  planMode: props.backendCapabilities.planMode !== 'unsupported',
  goals: props.backendCapabilities.goals,
  steerPrompt: props.backendCapabilities.steerPrompt,
  interrupt: props.backendCapabilities.interrupt,
  history: props.backendCapabilities.history,
  deleteTurn: props.backendCapabilities.deleteTurn,
  editTurn: props.backendCapabilities.editTurn,
  retryTurn: props.backendCapabilities.retryTurn,
  approvals: props.backendCapabilities.approvals,
  approvalPresets: props.backendCapabilities.approvalPresets ?? [],
}));
const permissionModeMenuItems = computed<CodexComposerMenuItem[]>(() => {
  const modes = props.backendCapabilities.permissionModes ?? [];
  if (modes.length === 0) {
    return [];
  }

  return [{
    id: 'backend-permissions',
    type: 'submenu',
    label: translate('surface.appShell.permissions'),
    icon: ShieldCheckIcon,
    submenuAlignment: 'bottom',
    submenuWidth: 'wide',
    items: modes.map((mode) => permissionModeMenuItem(mode, props.permissionMode)),
  }];
});
const currentModelFavorite = computed<ModelFavorite | null>(() => {
  const agent = currentAgent.value;
  const model = props.backendModels.find((candidate) => candidate.id === props.selectedModelId)
    ?? props.backendModels.find((candidate) => candidate.isDefault)
    ?? props.backendModels[0]
    ?? null;
  if (!agent || !model) return null;
  return {
    backend: agent.backend,
    modelId: model.id,
    reasoningEffort: props.selectedReasoningEffort
      ?? model.defaultReasoningEffort
      ?? model.supportedReasoningEfforts?.[0]?.reasoningEffort
      ?? null,
    serviceTier: props.selectedServiceTier === 'default' ? null : props.selectedServiceTier,
  };
});
const managedModelFavorites = computed(() => (
  modelFavoritesDialogBackend.value
    ? props.snapshot.general.modelFavorites.filter((favorite) => favorite.backend === modelFavoritesDialogBackend.value)
    : []
));
const modelFavoriteMenuItems = computed(() => buildModelFavoriteMenuItems(currentModelFavorite.value, props.backendModels));
function buildModelFavoriteMenuItems(current: ModelFavorite | null, models: BackendModelOption[]): CodexComposerMenuItem[] {
  if (!current) return [];
  const availableModelIds = new Set(models.map(model => model.id));
  const favorites = props.snapshot.general.modelFavorites.filter(favorite => favorite.backend === current.backend && availableModelIds.has(favorite.modelId));
  const currentIsFavorite = favorites.some((favorite) => sameModelFavorite(favorite, current));
  const items: CodexComposerMenuItem[] = [];
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
function splitModelFavoriteMenuItems(agentId: string): CodexComposerMenuItem[] {
  const view = props.agentConversationFor?.(agentId);
  if (!view) return [];
  const composer = view.composer;
  const model = composer.models.find(model => model.id === composer.selectedModelId)
    ?? composer.models.find(model => model.isDefault) ?? composer.models[0];
  if (!model) return [];
  return buildModelFavoriteMenuItems({
    backend: view.agent.backend,
    modelId: model.id,
    reasoningEffort: composer.selectedReasoningEffort ?? model.defaultReasoningEffort ?? model.supportedReasoningEfforts?.[0]?.reasoningEffort ?? null,
    serviceTier: composer.selectedServiceTier === 'default' ? null : composer.selectedServiceTier,
  }, composer.models);
}
function selectSplitModelMenuItem(agentId: string, item: Parameters<NonNullable<CodexConversationPaneActions['menuSelect']>>[0]): void | Promise<void> {
  const command = modelFavoriteCommand(item.payload);
  if (command) return handleModelFavoriteCommand(command, agentId);
}
const conversationPaneState: CodexConversationPaneState = {
  identity: {
    get conversationKey() { return conversationKey.value; },
    get activeTurnId() { return conversationActiveTurnId.value; },
    get turns() { return providerConversation.value?.turns; },
    get messages() { return conversationMessages.value; },
    get busy() { return providerConversation.value?.busy ?? props.isSending; },
    get disabled() {
      return backendSwitch.busy.value || !currentAgent.value || (props.isConversationLoadFailed && conversationMessages.value.length === 0);
    },
  },
  history: {
    get hasOlder() { return providerConversation.value?.historyState?.hasOlder ?? props.historyHasOlder; },
    get loading() {
      return Boolean(currentAgent.value?.backendSession)
        && conversationMessages.value.length === 0
        && (providerConversation.value?.historyLoading ?? (props.isLoading || props.isConversationLoading));
    },
    get loadingOlder() { return providerConversation.value?.historyState?.loadingOlder ?? props.historyLoadingOlder; },
  },
  thread: {
    get approvals() { return effectiveApprovals.value; },
    get clientRequests() {
      if (currentAgent.value?.backend === 'antigravity' && props.antigravityConversationSnapshot) return antigravityPaneClientRequests(props.antigravityConversationSnapshot);
      return currentAgent.value?.backend === 'codex'
        ? props.codexConversationSnapshot?.clientRequests ?? []
        : claudePaneClientRequests(props.claudeConversationSnapshot);
    },
    get answeredClientRequestIds() {
      return providerConversation.value
        ? new Set(providerConversation.value.answeredClientRequestIds)
        : currentAgent.value?.backend === 'codex' ? new Set<string>() : props.answeredClientRequestIds;
    },
    get goal() {
      return currentAgent.value?.backend === 'codex'
        ? props.codexConversationSnapshot?.goal ?? null
        : props.goal ?? null;
    },
    get queuedPrompts() {
      return props.queuedPrompts;
    },
    get contextUsage() { return providerConversation.value?.contextUsage ?? currentAgent.value?.contextUsage ?? null; },
  },
  composer: {
    get followUpBehavior() { return props.snapshot.general.followUpBehavior; },
    get state() { return props.composerState; },
    get attachments() { return props.composerAttachments; },
    get placeholder() {
      if (!currentAgent.value) return translate('surface.appShell.selectAnAgent');
      const backend = backendDisplayName(currentAgent.value.backend);
      if (props.isSending) return `${backend} is working...`;
      if (activeSurface.value === 'mission' && selectedMission.value?.stage === 'requirements' && conversationMessages.value.length === 0) {
        return t('missions.describeWhatYouWantToBuild');
      }
      return currentAgent.value.suggestedPrompt || translate('surface.appShell.askForFollowUpChanges');
    },
    get approvalPreset() { return props.approvalPreset; },
    get leadingMenuItems() { return [...permissionModeMenuItems.value, ...conversationCommandMenuItems()]; },
    get modelMenuItems() { return modelFavoriteMenuItems.value; },
    get planMode() { return props.planMode; },
    get selectedModelId() { return props.selectedModelId; },
    get selectedReasoningEffort() { return props.selectedReasoningEffort; },
    get selectedServiceTier() { return props.selectedServiceTier; },
  },
  catalogs: {
    get files() { return props.agentFiles; },
    get models() { return props.backendModels; },
    get commands() { return props.backendCommands; },
    get plugins() { return props.backendPlugins; },
    get skills() { return props.backendSkills; },
    get mentionGroups() { return agentMentionGroups.value; },
    get modelCatalogStatus() { return props.modelCatalogStatus; },
    get skillCatalogStatus() { return props.skillCatalogStatus; },
  },
  get capabilities() { return conversationCapabilities.value; },
  policy: {
    get attachEnabled() { return props.backendCapabilities.attachments; },
    get canDeleteTurn() { return props.backendCapabilities.deleteTurn; },
    get canEditTurn() { return props.backendCapabilities.editTurn; },
    get canForkTurn() {
      const agent = currentAgent.value;
      return Boolean(agent && forkableAgentIds.value.includes(agent.id));
    },
    get canRetryTurn() { return props.backendCapabilities.retryTurn; },
  },
};
const conversationPaneActions: CodexConversationPaneActions = {
  cancel: () => emit('interrupt-agent'),
  continueInterruptedTurn: () => props.continueInterruptedTurnAction?.(),
  clearGoal: () => emit('clear-goal'),
  clientResponse: (response) => {
    if (debugUserQuestions.value?.requestId === response.id) {
      debugUserQuestions.value = null;
      return;
    }
    emit('client-response', response);
  },
  deleteTurn: (turnId) => props.deleteTurnAction?.(turnId) ?? emit('delete-turn', turnId),
  deleteQueuedPrompt: (promptId) => emit('delete-queued-prompt', promptId),
  editTurn: (payload) => props.editTurnAction?.(payload) ?? emit('edit-turn', payload),
  forkTurn: (turnId) => emit('fork-turn', turnId),
  interrupt: () => emit('interrupt-agent'),
  loadOlderHistory: () => props.loadOlderAgentHistory?.(currentAgent.value?.id ?? ''),
  menuSelect: (item) => {
    const composerCommand = conversationMenuCommand(item.payload);
    if (composerCommand && currentAgent.value) return runConversationMenuCommand(currentAgent.value.id, composerCommand);
    const favoriteCommand = modelFavoriteCommand(item.payload);
    if (favoriteCommand) {
      void handleModelFavoriteCommand(favoriteCommand);
      return;
    }
    const command = permissionModeCommand(item.payload);
    if (command) emit('select-permission-mode', command.mode);
  },
  openLink: (link) => agentWorkspace.value?.openConversationLink(link),
  openImage: (image, context) => agentWorkspace.value?.openConversationImage(image, context) ?? false,
  openVisualization: (visualization) => agentWorkspace.value?.openConversationVisualization(visualization),
  resolveApproval: forwardApprovalResolution,
  retryTurn: (turnId) => props.retryTurnAction?.(turnId) ?? emit('retry-turn', turnId),
  sendFollowUp: forwardCodexPrompt,
  steer: forwardCodexSteerPrompt,
  steerQueuedPrompt: (promptId, prompt) => emit('steer-queued-prompt', promptId, prompt),
  updateQueuedPrompt: (promptId, prompt) => emit('update-queued-prompt', promptId, prompt),
  submit: forwardCodexPrompt,
  updateAttachments: updateConversationAttachments,
  updateComposerState: updateConversationComposerState,
  updateSettings: (settings) => {
    if (settings.approvalPreset !== undefined) emit('select-approval-preset', settings.approvalPreset);
    if (settings.modelId !== undefined) emit('select-model', settings.modelId);
    if (settings.planMode !== undefined) emit('update:planMode', settings.planMode);
    if (settings.reasoningEffort !== undefined) emit('select-reasoning-effort', settings.reasoningEffort);
    if (settings.serviceTier !== undefined) emit('select-service-tier', settings.serviceTier);
  },
};

const delegatingAgentIds = new Set<string>();
async function delegateAgent(agentId: string): Promise<void> {
  if (delegatingAgentIds.has(agentId)) return;
  delegatingAgentIds.add(agentId);
  try {
    await backendSwitch.settled();
    if (!props.snapshot.agents.some(agent => agent.id === agentId)) throw new Error(t('delegation.agentUnavailable'));
    if (props.agentConversationActions) await props.agentConversationActions.send(agentId, '/delegate');
    else if (currentAgent.value?.id === agentId) {
      requireConnectedConversation();
      if (props.sendPromptAction) await props.sendPromptAction('/delegate');
      else emit('sendPrompt', '/delegate');
    } else throw new Error(t('delegation.agentUnavailable'));
  } finally {
    delegatingAgentIds.delete(agentId);
  }
}

async function runConversationMenuCommand(agentId: string, command: ConversationMenuCommand): Promise<void> {
  try {
    if (command === 'review') return await openCodeReviewForAgent(agentId);
    if (command === 'visualize') return await startVisualizeForAgent(agentId);
    await delegateAgent(agentId);
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
    modelFavoritesDialogBackend.value = (agentId ? props.snapshot.agents.find(agent => agent.id === agentId) : currentAgent.value)?.backend ?? null;
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
  const firstBackendIndex = existing.findIndex((favorite) => favorite.backend === backend);
  const withoutBackend = existing.filter((favorite) => favorite.backend !== backend);
  const insertionIndex = firstBackendIndex < 0
    ? withoutBackend.length
    : existing.slice(0, firstBackendIndex).filter((favorite) => favorite.backend !== backend).length;
  withoutBackend.splice(insertionIndex, 0, ...favorites.map(copyModelFavorite));
  await props.updateSettings({ general: { modelFavorites: withoutBackend } });
}

function permissionModeMenuItem(
  mode: BackendPermissionModeOption,
  selectedMode: string | null,
): CodexComposerMenuItem {
  return {
    id: `permission-mode:${mode.id}`,
    type: 'radio',
    label: localizedText(mode.label, translate) ?? mode.id,
    description: localizedText(mode.description, translate) ?? '',
    checked: mode.id === selectedMode,
    payload: { kind: 'permission-mode', mode: mode.id },
  };
}

function permissionModeCommand(payload: unknown): { kind: 'permission-mode'; mode: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  return record.kind === 'permission-mode' && typeof record.mode === 'string'
    ? { kind: 'permission-mode', mode: record.mode }
    : null;
}
const conversationPaneController = createCodexConversationPaneController({
  state: conversationPaneState,
  actions: conversationPaneActions,
});

function saveActivePromptDraft(): void {
  if (activeSurface.value === 'mission') void missionConversationPane.value?.saveCurrentDraft();
  else focusedConversationPanel()?.saveCurrentDraft();
}

function openActiveSavedPromptDrafts(): void {
  void nextTick(() => {
    if (activeSurface.value === 'mission') missionConversationPane.value?.openSavedDraftPicker();
    else focusedConversationPanel()?.openSavedDraftPicker();
  });
}

function compactAgentSession(agentId: string): void {
  const agent = props.snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent || !defaultBackendCommands(agent.backend).some(command => command.slashName === 'compact')) return;
  emit('send-agent-prompt', { agentId, prompt: '/compact' });
}

const showAgentDialogTeamSelector = computed(() => agentDialogMode.value === 'create' && pendingNewAgentWorkItem.value !== null);
const pendingNewAgentName = '';
const pendingNewAgentWorktreeBranchName = computed(() => (
  pendingNewAgentWorkItem.value ? pendingWorkItemBranchName.value : agentDialogSourceBranchName.value
));
const isAgentEmpty = computed(() => activeTeamAgents.value.length === 0);
const cockpitVisible = computed(() => activeSurface.value === 'cockpit');
const cockpitResponsePreviews = computed(() => Object.fromEntries(
  props.snapshot.agents.map(agent => [agent.id, cockpitResponsePreview(props.agentConversationFor?.(agent.id))]),
));
const backlogVisible = computed(() => activeSurface.value === 'backlog');
const automationsVisible = computed(() => activeSurface.value === 'automations');
const settingsVisible = computed(() => activeSurface.value === 'settings');
async function setEngineEnabled(backend: AgentBackend, enabled: boolean) {
  if (!appApi) throw new Error('Backend connection is unavailable.');
  await appApi.setProviderEnabled(backend, enabled);
}
const isAgentWorkspaceVisible = computed(() => activeSurface.value === 'agent');
const isModalDialogVisible = computed(() => (
  agentDialogVisible.value
  || handoffAgentId.value !== null
  || modelFavoritesDialogVisible.value
  || newProjectDialogVisible.value
  || teamDialogVisible.value
  || whatsNewVisible.value
  || keyboardShortcutsVisible.value
  || commandPaletteVisible.value
  || imageAnnotationVisible.value
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
  idleSession: Boolean(currentAgent.value?.backendSession && currentAgent.value.status.type === 'idle' && defaultBackendCommands(currentAgent.value.backend).some(command => command.slashName === 'compact')),
}));
const navigation = ref<InstanceType<typeof AppShellNavigation> | null>(null);
const { quickAgentShortcutsVisible, executeAppCommand } = useAppShellCommands({
  state: {
    activeTeam: () => activeTeam.value,
    activeTeamAgents: () => activeTeamAgents.value,
    quickSwitchAgentIds: () => navigation.value?.quickSwitchAgentIds ?? activeTeamAgents.value.map(agent => agent.id),
    agents: () => props.snapshot.agents,
    attachmentsEnabled: () => props.backendCapabilities.attachments,
    composerAttachments: () => props.composerAttachments,
    currentAgent: () => hasFocusedConversation.value ? currentAgent.value : null,
    canReplaceConversation: () => Boolean(currentAgent.value && summaryReplacementAgentIds.value.includes(currentAgent.value.id)),
    isAgentWorkspaceVisible: () => isAgentWorkspaceVisible.value,
    isModalDialogVisible: () => isModalDialogVisible.value,
    showOnboardingGate: () => showOnboardingGate.value,
    teams: () => props.snapshot.teams,
    remoteConnections: () => props.snapshot.remoteConnections.connections,
    loadRemoteTeams,
  },
  actions: {
    closeAgent: (agentId) => emit('close-agent', agentId),
    compactSession: compactAgentSession,
    replaceConversationWithSummary: (agentId) => emit('compress-session', agentId),
    closeTeam: (teamId) => emit('close-team', teamId),
    disconnectTeam: (teamId) => emit('disconnect-team', teamId),
    debugMarkUnread: () => emit('debug-mark-unread'),
    duplicateAgent: (agentId) => emit('duplicate-agent', agentId),
    editAgent: openEditAgent,
    forkAgent: (agentId) => { if (forkableAgentIds.value.includes(agentId)) emit('fork-agent', agentId); },
    handoffAgent: openHandoff,
    focusComposer: () => focusedConversationPanel()?.focusComposer(),
    newTeam: openNewTeam,
    openAgentPalette: () => { agentQuickOpenVisible.value = true; },
    openSavedPromptDrafts: openActiveSavedPromptDrafts,
    openAgentSurface: () => { activeSurface.value = 'agent'; },
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
    toggleSpokenAnnouncementsMuted,
    updateComposerAttachments: (agentId, attachments) => emit('update:composerAttachments', { agentId, attachments }),
    updateComposerState: (agentId, state) => emit('update:composerState', { agentId, state }),
  },
});

const paletteActions = computed(() => {
  const agent = hasFocusedConversation.value ? currentAgent.value : null;
  const team = activeTeam.value;
  const remote = team?.remoteConnectionId;
  return commandPaletteActions({
    shortcuts: shortcutContext.value, agent, team,
    settings: { appshots: appHostCapabilities.appshots, availableBackends: props.snapshot.providerConnections?.map(provider => provider.backend) ?? [] },
    connected: props.connectionState.status === 'connected',
    hostConnected: !remote || props.snapshot.remoteConnections.connections.some(connection => connection.id === remote && connection.status === 'ready'),
    engineConnected: Boolean(agent && preferredBackendChoices(props.snapshot, agent.teamId).includes(agent.backend)),
    canCreateAgent: Boolean(preferredBackendChoices(props.snapshot, team?.id).length),
    capabilities: { ...defaultBackendCapabilities(agent?.backend ?? 'codex'), ...currentBackendRuntime.value.capabilities },
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
            kind: 'ask_user',
            conversationId: `debug-${agentId}`,
            turnId,
            itemId,
            payload: {
              request: {
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
        },
      ],
    },
  };
}

function openDebugOperationProgress(
  kind: Extract<AppCommand, { type: 'debug-operation-progress' }>['kind'],
): void {
  if (kind === 'worktreeInitialization') {
    startDebugAgentCreationProgress();
    return;
  }

  activeSurface.value = 'agent';
  void nextTick(() => agentWorkspace.value?.showDebugGitOperationProgress(kind));
}

function startDebugAgentCreationProgress(): void {
  clearDebugAgentCreationTimers();
  const id = `debug-agent-creation-${Date.now()}`;
  debugAgentCreationProgress.value = {
    id,
    state: 'running',
    backend: 'codex',
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

function closeProvisioningProgress(id: string): void {
  closeDebugAgentCreationProgress(id);
  closeRepositorySessionCreationProgress(id);
  closeWorkItemCreationProgress(id);
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
const showAgentSidebar = computed(() => (isAgentWorkspaceVisible.value || activeSurface.value === 'mission') && (compactViewport.value || !agentSidebarCollapsed.value) && (props.snapshot.teams.length > 0 || !!props.snapshot.missions?.length));
const editingAgent = computed(() => (
  editingAgentId.value ? props.snapshot.agents.find((agent) => agent.id === editingAgentId.value) ?? null : null
));
const editingTeam = computed(() => (
  editingTeamId.value ? props.snapshot.teams.find((team) => team.id === editingTeamId.value) ?? null : null
));
const agentDialogTargetTeam = computed(() => {
  const targetTeamId = agentDialogTeamId.value ?? activeTeam.value?.id ?? props.snapshot.activeTeamId;
  return targetTeamId
    ? props.snapshot.teams.find((team) => team.id === targetTeamId) ?? null
    : null;
});
const agentDialogRemoteConnectionId = computed(() => agentDialogTargetTeam.value?.remoteConnectionId ?? '');
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
    const backend = preferredBackendChoices(props.snapshot, teamId)[0];
    if (!backend) { openSettings(); return; }
    const created = await props.createQuickChat({ backend, ...(teamId ? { teamId } : {}) });
    if (created !== null) activeSurface.value = 'agent';
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleStartWorkAction(action: 'new' | 'github' | 'local' | 'url'): Promise<void> {
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

async function createNewProject(name: string, backend: Agent['backend']): Promise<void> {
  const { teamId } = repositorySessionContext(null);
  newProjectBusy.value = true;
  newProjectError.value = null;
  try {
    await props.createProject({
      name,
      backend,
      ...(teamId ? { teamId } : {}),
    });
    newProjectDialogVisible.value = false;
  } catch (error) {
    newProjectError.value = localizedErrorMessage(error, t);
  } finally {
    newProjectBusy.value = false;
  }
}

function completeGitHubOnboardingStep(): void {
  repositoryAcquireBusy.value = false;
  repositoryAcquireError.value = null;
  firstRunOnboarding.completeGitHub();
}

watch(() => [githubConnection.value.status, githubConnection.value.source] as const, ([status, source]) => {
  if (githubOnboardingVisible.value && status === 'connected' && source !== 'cli') {
    completeGitHubOnboardingStep();
  }
});

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

async function loadRemoteTeams(connectionId: string): Promise<Team[]> {
  if (!props.getAutomationSnapshot) {
    throw new Error(t('surface.team-close-confirmation.remoteTeamsUnavailable'));
  }
  const remoteSnapshot = await props.getAutomationSnapshot({ kind: 'remote', remoteConnectionId: connectionId });
  return remoteSnapshot.teams;
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
  activeSurface.value = 'cockpit';
}

async function openBacklog(): Promise<void> {
  if (backlogVisible.value && backlogInitialized) return;
  activeSurface.value = 'backlog';
  backlogInitialized = true;
  await initializeCockpitBacklog();
}

function openAutomations(): void {
  activeSurface.value = 'automations';
}

function openSettings(tab?: SettingsTab): void {
  if (tab) settingsActiveTab.value = tab;
  activeSurface.value = 'settings';
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

async function readConversationMessages(ref: BackendConversationRef, agentId: string, location?: AutomationLocation): Promise<RendererMessage[]> {
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
  activeSurface.value = 'agent';
  emit('select-team', teamId);
}

function selectAgentFromShell(agentId: string): void {
  activeSurface.value = 'agent';
  pendingComposerFocusAgentId.value = agentId;
  split.select(agentId);
  emit('select-agent', agentId);
}

function selectAgentFromCockpit(payload: { agentId: string; teamId: string }): void {
  activeSurface.value = 'agent';
  pendingComposerFocusAgentId.value = payload.agentId;
  emit('select-team', payload.teamId);
  emit('select-agent', payload.agentId);
}

function selectAgentFromPalette(payload: { agentId: string; teamId: string }): void {
  activeSurface.value = 'agent';
  pendingComposerFocusAgentId.value = payload.agentId;
  if (payload.teamId === activeTeam.value?.id) split.select(payload.agentId);
  if (payload.teamId !== activeTeam.value?.id) emit('select-team', payload.teamId);
  emit('select-agent', payload.agentId);
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

const threadFlagBusy = ref(false);
async function respondToThreadFlag(response: ThreadFlagResponse): Promise<void> {
  if (response.id === 'delegate_to_worktree' && response.action === 'execute' && currentAgent.value) {
    return runConversationMenuCommand(currentAgent.value.id, 'delegate');
  }
  if (!props.respondToThreadFlagAction || threadFlagBusy.value) return;
  threadFlagBusy.value = true;
  try {
    await props.respondToThreadFlagAction(response);
    if (response.id === 'ready_for_review' && response.action === 'execute') {
      openRightWorkspaceTab('codeReview');
    }
  } catch (error) {
    ElMessage.error(localizedErrorMessage(error, t));
  } finally {
    threadFlagBusy.value = false;
  }
}

function forwardApprovalResolution(
  approvalId: string,
  decision: BackendApprovalDecision,
  scope: BackendApprovalScope,
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
  void nextTick(() => missionConversationPane.value?.focusComposer());
}

function forwardPrompt(prompt: string, options?: RendererSendPromptOptions): void | Promise<void> {
  const visualizeCommand = prompt.match(/^\/visualize(?:\s+([\s\S]*))?$/u);
  if (visualizeCommand && !options?.attachments?.length && currentAgent.value) {
    const direction = visualizeCommand[1]?.trim();
    return startVisualizeForAgent(currentAgent.value.id, direction ? { prompt: direction } : undefined);
  }
  const reviewCommand = prompt.trim().match(/^\/review(?:\s+([\s\S]*))?$/u);
  if (reviewCommand && !options?.attachments?.length && currentAgent.value) {
    return openCodeReviewForAgent(currentAgent.value.id, reviewCommand[1]?.trim());
  }
  const clarification = pendingReviewClarification.value;
  if (
    clarification
    && clarification.agentId === currentAgent.value?.id
    && !options?.attachments?.length
  ) {
    return props.discussCodeReviewFinding(clarification.agentId, {
      sessionId: clarification.sessionId,
      roundId: clarification.roundId,
      findingId: clarification.findingId,
      question: prompt,
    }).then(() => {
      if (pendingReviewClarification.value === clarification) {
        pendingReviewClarification.value = null;
      }
    });
  }
  if (props.sendPromptAction) return props.sendPromptAction(prompt, options);
  if (options) {
    emit('sendPrompt', prompt, options);
  } else {
    emit('sendPrompt', prompt);
  }
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

async function forwardCodexPrompt(prompt: string, options?: CodexRendererSendMessageOptions): Promise<void> {
  const capturedImages = imageAnnotation.capture();
  await backendSwitch.settled();
  requireConnectedConversation();
  await forwardCodexPromptWithVisualizationAnnotations(
    prompt,
    options,
    (visualizationPrompt, visualizationOptions) => forwardCodexPromptWithChatTextAnnotations(
      visualizationPrompt,
      visualizationOptions,
      (nextPrompt, nextOptions) => forwardCodexPromptWithImageAnnotations(
        nextPrompt,
        nextOptions,
        forwardPrompt,
        capturedImages,
      ),
    ),
  );
}

async function forwardCodexSteerPrompt(prompt: string, options?: CodexRendererSendMessageOptions): Promise<void> {
  const capturedImages = imageAnnotation.capture();
  requireConnectedConversation();
  await forwardCodexPromptWithVisualizationAnnotations(
    prompt,
    options,
    (visualizationPrompt, visualizationOptions) => forwardCodexPromptWithChatTextAnnotations(
      visualizationPrompt,
      visualizationOptions,
      (nextPrompt, nextOptions) => forwardCodexPromptWithImageAnnotations(
        nextPrompt,
        nextOptions,
        forwardSteerPrompt,
        capturedImages,
      ),
    ),
  );
}

function requireConnectedConversation(): void {
  const agent = currentAgent.value;
  if (agent && !preferredBackendChoices(props.snapshot, agent.teamId).includes(agent.backend)) {
    throw new Error(t('engineConnection.required'));
  }
}

function updateConversationComposerState(state: CodexComposerState): void {
  const agentId = currentAgent.value?.id;
  if (agentId) emit('update:composerState', { agentId, state });
}

function updateConversationAttachments(attachments: readonly CodexNativeAttachment[]): void {
  const agentId = currentAgent.value?.id;
  if (!agentId) return;
  pruneSavedImageAnnotations(agentId, attachments);
  emit('update:composerAttachments', { agentId, attachments });
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

async function savePromptDraft(agentId: string, text: string): Promise<void> {
  if (!text.trim() || text.length > 131_072) throw new Error(t('chat.savedDrafts.invalid'));
  const savedPromptDrafts = [...props.snapshot.general.savedPromptDrafts.map((draft) => ({ ...draft })), {
    id: crypto.randomUUID(), agentId, text, createdAt: Date.now(),
  }].slice(-100);
  await updateSettings({ general: { savedPromptDrafts } });
}

async function removePromptDraft(id: string): Promise<void> {
  await updateSettings({ general: { savedPromptDrafts: props.snapshot.general.savedPromptDrafts.filter((draft) => draft.id !== id).map((draft) => ({ ...draft })) } });
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

function updateCockpitAgentViewMode(cockpitAgentViewMode: CockpitAgentViewMode): void {
  void updateSettings({ general: { cockpitAgentViewMode } });
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

async function connectWorkProvider(provider: WorkProviderKind): Promise<void> {
  await props.connectWorkProvider(provider);
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
  for (const request of requests) openMarkdownRequest(request);
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
.app-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  color: var(--color-text);
  background: var(--color-shell-window);
}

.app-shell--auth-gated > :not(.codex-login):not(.github-onboarding):not(.onboarding-complete) {
  visibility: hidden;
}

.app-shell__nav {
  display: contents;
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
