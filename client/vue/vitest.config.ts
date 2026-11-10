import { sdkSourceAliases, sdkSourceRoot, sdkSourcesEnabled } from '../../vite.sdk-aliases';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

const logicTestFiles = [
  'src/__tests__/async-catalog-cache.spec.ts',
  'src/__tests__/collaboration-message.spec.ts',
  'src/__tests__/i18n-contract.spec.ts',
  'src/__tests__/localized-error-message.spec.ts',
  'src/__tests__/tool-presentation.spec.ts',
  'src/__tests__/tool-title-presenter.spec.ts',
  'src/components/__tests__/cockpit-agent-layout.spec.ts',
  'src/components/__tests__/image-annotation.spec.ts',
  'src/components/__tests__/repository-session-context.spec.ts',
  'src/components/__tests__/use-chat-text-annotations.spec.ts',
  'src/components/__tests__/use-repository-session-menu.spec.ts',
  'src/components/__tests__/use-work-item-routing.spec.ts',
  'src/components/__tests__/use-workspace-previews.spec.ts',
  'src/shared/__tests__/use-debounced-save.spec.ts',
  'src/shared/confetti/__tests__/canvas-celebration.spec.ts',
  'src/theme/__tests__/themes.spec.ts',
];

export default defineConfig({
  plugins: [vue()],
  server: { fs: { allow: [path.resolve(__dirname, '../..'), ...(sdkSourcesEnabled ? [sdkSourceRoot] : [])] } },
  resolve: {
    dedupe: ['vue', 'element-plus'],
    alias: [
      { find: '@workspace/core', replacement: path.resolve(__dirname, '../../core/src') },
      ...sdkSourceAliases,
    ],
  },
  test: {
    testTimeout: 2_500,
    hookTimeout: 2_500,
    // Vitest schedules groups by array index; negative groups are skipped.
    sequence: { groupOrder: 2 },
    environment: 'jsdom',
    css: {
      // Opt in only components with valuable runtime CSS assertions.
      include: [/agent-ui-sdk.*styles\.css/, /(BrowserPanel|AnnotationSendButton)\.vue/, /MarkdownPanel\.vue/, /GitPruneDialog\.vue/, /CodexLoginLanding\.vue/, /ProviderInstallActions\.vue/, /AppMenu\.vue/, /TeamRail\.vue/, /Form(Section|Row)\.vue/, /SettingsMenu\.vue/, /AutomationsView\.vue/, /Automation(Schedule)?Editor\.vue/, /AnnotationOverlayApp\.vue/, /MissionWorkspace\.css/, /Mission(Conversation|Stage)Rail\.vue/, /(?:WorkspaceHeader|PaneTransition)\.vue/, /AgentSidebar(?:Repo|Activity)?\.vue/, /(?:Activity|Repository)AgentRow\.vue/, /agent-row\.css/, /agent-sidebar-common\.css/, /SettingsSidebar\.vue/, /Backend(Icon|Selector)\.vue/, /SourcePreviewPanel\.vue/, /CodeReviewPanel\.vue/, /ReviewFindingList\.vue/, /MissionShipBoard\.vue/, /MissionImplementationBoard\.css/, /MissionImplementationTicketCard\.vue/, /RepositorySessionSourceDialog\.vue/, /RightWorkspacePanel\.vue/, /WorkspaceLinkDropTarget\.vue/, /AgentWorkspace\.vue/, /ConversationPane\.vue/, /SplitLayoutControl\.vue/, /ProviderSetupDialog\.vue/, /BacklogView\.vue/, /BacklogSourceSelector\.vue/, /base\.css/, /el-select\.css/, /el-icon\.css/],
    },
    pool: 'vmThreads',
    vmMemoryLimit: '2GB',
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          sequence: { groupOrder: 2 },
          environment: 'node',
          include: logicTestFiles,
          setupFiles: [],
        },
      },
      {
        // Real Chromium through Playwright: layout, pointer and style behavior jsdom cannot show.
        extends: true,
        test: {
          name: 'browser',
          // Cold Vite/Chromium work must not contend with short DOM behavior tests.
          sequence: { groupOrder: 1 },
          fileParallelism: false,
          environment: 'node',
          pool: 'forks',
          include: ['tests/browser/**/*.browser.spec.mjs'],
          setupFiles: [],
          // These workflows include cold Vite transforms and Chromium startup.
          // Individual interactions have their own short bounds.
          testTimeout: 30_000,
          hookTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          sequence: { groupOrder: 2 },
          include: ['src/**/*.spec.ts', 'tests/support/**/*.spec.ts'],
          exclude: logicTestFiles,
          setupFiles: [path.resolve(__dirname, 'tests/support/setup.ts')],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          sequence: { groupOrder: 2 },
          include: ['tests/integration/**/*.spec.ts'],
          setupFiles: [path.resolve(__dirname, 'tests/support/setup.ts')],
          // Composed renderer workflows exercise app state, screens and their backend boundary.
          testTimeout: 5_000,
          hookTimeout: 5_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/bootstrap.ts',
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'tests/**',
      ],
      thresholds: {
        statements: 85,
      },
    },
  },
});
