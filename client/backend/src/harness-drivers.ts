import { createHarness, type HarnessOptions } from '@korus-dev/multi-agent-sdk';
import { isBookkeepingTool } from '@workspace/core/bookkeeping-tools';
import type { Agent, HarnessProvider, ProviderModelOption } from '@workspace/core/contracts';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import { agentDisplayName } from '@workspace/core/agent-display';
import { shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import { product } from '@workspace/core/product';
import type { ProviderDriverRegistryOptions } from './driver-rpc';
import { AgentRegistry, HarnessAgentDriver, type DriverPolicy } from './harness-agent-driver';
import { agentScopedMcpUrl, appMcpUrlForAgent, buildAppMcpConfigOverrides, buildAppThreadConfig } from './mcp/codex-config';
import { appDeveloperInstructions } from './mcp/agent-prompts';
import { promptWithSelectedReferences } from './agents/prompt-content';
import { utilityTextModel } from './agents/utility-text-model';
import { utilityMcpServers } from './diagram-icons/utility-mcp';
import { antigravityGenerationPrompt } from './agents/prompts';
import { backendCodexHomeDir, backendHomeDir } from './state';
import { debugMain, logMain, warnMain } from './log';
import { resolveCodexLaunch } from './codex/codex-command';
import { traceCodexDiagnostic } from './codex/diagnostics';
import { codexConversationDefaults } from './codex/codex-model-defaults';
import { resolveClaudeLaunch } from './claude/claude-command';
import { resolveCursorExecutable } from './cursor/runtime';
import { isAppMcpServerName } from '@workspace/core/product';

type Options = ProviderDriverRegistryOptions;
/** Builds the Harness for a provider; tests substitute a scripted one. */
export type HarnessFactory = (provider: Agent['provider'], options: HarnessOptions) => ReturnType<typeof createHarness>;
const realHarness: HarnessFactory = (provider, options) => createHarness(provider, options);
const reviewBaseTools = ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round'] as const;
const planOnly = '\nWrite the plan and stop. Do not implement it or request implementation approval in this turn; Korus will collect the decision after showing the plan.';

/** App identity, instructions and MCP wiring shared by every provider. */
function common(options: Options, agents: AgentRegistry): Pick<HarnessOptions, 'client' | 'stateDirectory' | 'formatPrompt' | 'trustedMcpServerName' | 'isBookkeepingTool' | 'instructions' | 'mcpServers' | 'log'> {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  void settings;
  return {
    client: { name: product.mcpServerName, title: product.name, metadataDirectory: 'korus-sessions', temporaryDirectory: 'korus-tmp' },
    stateDirectory: backendHomeDir,
    formatPrompt: promptWithSelectedReferences,
    trustedMcpServerName: product.mcpServerName,
    isBookkeepingTool,
    instructions: (context, { planMode }) => {
      const agent = agents.get(context.id);
      return appDeveloperInstructions(agent, options.pluginSettings?.(), { celebrationsEnabled: options.celebrationsEnabled?.(), developerInstructions: options.additionalDeveloperInstructions?.(agent) }) + (planMode ? planOnly : '');
    },
    mcpServers: context => {
      const agent = agents.get(context.id);
      return [
        ...(options.appMcpServerUrl ? [{ name: product.mcpServerName, url: appMcpUrlForAgent(options.appMcpServerUrl, agent) }] : []),
        ...Object.entries(options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => ({ name, url: agentScopedMcpUrl(url, agent.id) })),
      ];
    },
    log: (level, component, message, details) => (level === 'debug' ? debugMain : level === 'info' ? logMain : warnMain)(component, message, details),
  };
}

const reviewScope = (extra: { approval?: 'auto'; required?: boolean; tools: readonly string[]; developerInstructions?: string }) => (url: string) => ({
  id: url, ...(extra.developerInstructions === undefined ? {} : { developerInstructions: extra.developerInstructions }),
  mcpServers: [{ name: product.mcpServerName, url, ...(extra.approval ? { approval: extra.approval } : {}), ...(extra.required ? { required: true } : {}), enabledTools: [...extra.tools] }],
}) as never;

const driver = (provider: Agent['provider'], harness: ReturnType<typeof createHarness>, agents: AgentRegistry, policy: Omit<DriverPolicy, 'agents' | 'displayName'>) =>
  new HarnessAgentDriver(provider, harness, { agents, displayName: agentDisplayName, ...policy });

function createCursorDriver(options: Options = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const agents = new AgentRegistry();
  const home = settings()?.providerHomes?.cursor;
  const harness = make('cursor', { ...common(options, agents),
    ...(home?.isolated ? { home: home.homePath } : {}),
    cursor: { command: resolveCursorExecutable, steeringFallback: () => settings()?.cursorSteeringFallbackEnabled === true },
  });
  return driver('cursor', harness, agents, {
    coordinationPolicy: { permissionModeScope: 'provider', rollbackStorageState: 'active', authentication: { actions: ['check', 'cancel', 'logout', 'login'], refreshOnAdmission: true, enableOnSuccess: false } },
    reviewScope: reviewScope({ tools: ['read-skill', ...reviewBaseTools, 'send-message', 'set-status', 'finish_turn'] }),
  });
}

export function createAntigravityDriver(options: Options = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const agents = new AgentRegistry();
  const harness = make('antigravity', { ...common(options, agents),
    antigravity: { command: process.env.APP_ANTIGRAVITY_COMMAND, harnessPath: process.env.ANTIGRAVITY_HARNESS_PATH },
  });
  return driver('antigravity', harness, agents, {
    coordinationPolicy: { authentication: { actions: ['check', 'cancel', 'logout', 'login'] } },
    reviewScope: reviewScope({ developerInstructions: '', tools: [...reviewBaseTools, 'set-status', 'finish_turn'] }),
    prepareGeneration: (_agent, input) => {
      const { outputSchema, ...rest } = input;
      const mcpServers = utilityMcpServers(input.mcpServers);
      return { ...rest, mcpServers, prompt: antigravityGenerationPrompt({ developerInstructions: input.developerInstructions, prompt: input.prompt, outputSchema, hasMcpServers: mcpServers.length > 0 }), developerInstructions: undefined, selectModel: (models: readonly ProviderModelOption[]) => utilityTextModel('antigravity', models, input.complexity) };
    },
  });
}

export function createClaudeDriver(options: Options & { homeDir?: string } = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const agents = new AgentRegistry();
  const harness = make('claude', { ...common(options, agents),
    client: { name: product.name, title: product.name, metadataDirectory: 'korus-sessions', entrypoint: product.slug, clientApp: 'agent-workspace' },
    ...(options.homeDir ? { home: options.homeDir } : {}),
    generationMcpServers: value => utilityMcpServers(value as never).map(server => ({ ...server, approval: 'auto' as const })),
    claude: { launch: (command, env) => resolveClaudeLaunch(command, env), decideTool: tool => tool === 'ExitPlanMode' ? { behavior: 'deny' as const, message: `${product.name} captured the proposed plan. Wait for the user to review or request implementation.` } : undefined, disallowedTools: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'] },
  });
  void settings;
  return driver('claude', harness, agents, {
    reviewScope: reviewScope({ approval: 'auto', tools: [...reviewBaseTools, 'send-message', 'set-status', 'finish_turn'] }),
    prepareGeneration: (_agent, input) => ({ ...input, selectModel: (models: readonly ProviderModelOption[]) => utilityTextModel('claude', models, input.complexity) }),
  });
}

/** The Harness options Korus runs Codex with. */
export function codexHarnessOptions(options: Options, agents: AgentRegistry): HarnessOptions {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const base = common(options, agents);
  return {
    client: { name: 'workspace', title: product.name, version: '0.3.0', metadataDirectory: base.client.metadataDirectory },
    formatPrompt: base.formatPrompt, trustedMcpServerName: product.mcpServerName, log: base.log,
    home: settings()?.providerHomes?.codex?.homePath ?? backendCodexHomeDir(),
    onDiagnostic: traceCodexDiagnostic,
    codex: {
      launch: resolveCodexLaunch(settings()?.codexBinaryPath),
      config: ['features.default_mode_request_user_input=true', ...buildAppMcpConfigOverrides(options.pluginSettings?.() ?? settings()?.plugins)],
      defaultModel: codexConversationDefaults,
      conversationConfig: (context, scope) => {
        const agent = agents.get(context.id);
        return buildAppThreadConfig(agent, scope?.mcpServerUrl ?? options.appMcpServerUrl ?? null, options.pluginSettings?.() ?? settings()?.plugins,
          { celebrationsEnabled: options.celebrationsEnabled?.() ?? settings()?.celebrationsEnabled, developerInstructions: options.additionalDeveloperInstructions?.(agent) },
          scope?.mcpServerUrl ? {} : options.hostedMcpServerUrls?.() ?? {}) as never;
      },
      syncTitle: context => shouldSyncConversationTitleFromAgent(agents.get(context.id)),
      retainedSessions: context => {
        const agent = agents.get(context.id);
        const active = agent.codeReview?.rounds.find(round => round.id === agent.codeReview?.activeRoundId);
        return active?.reviewerSession ? [active.reviewerSession] : [];
      },
      imageModel: (models) => {
        const luna = [...models].filter(model => /(?:^|[-_\s])luna(?:$|[-_\s])/i.test(model.id)).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0];
        if (!luna) throw new Error('No Luna model is available in the Codex model catalog.');
        return { model: luna.id, reasoningEffort: 'low' };
      },
      onRequestSettled: process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1' ? info => {
        if (!/^(?:initialize|thread\/(?:resume|read|list|turns\/.*|goal\/get)|permissionProfile\/list|configRequirements\/read|model\/list|skills\/list)$/.test(info.method)) return;
        console.warn('[conversation-load] ' + JSON.stringify({ layer: 'codex-rpc', method: info.method, id: info.id, outcome: info.outcome, startAt: info.startedAt, at: info.startedAt + info.durationMs, durationMs: info.durationMs }));
      } : undefined,
    },
  };
}

export function createCodexDriver(options: Options = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const agents = new AgentRegistry();
  const harness = make('codex', codexHarnessOptions(options, agents));
  return driver('codex', harness, agents, {
    coordinationPolicy: { authentication: { actions: ['check', 'cancel', 'logout', 'login'] } },
    reviewScope: reviewScope({ approval: 'auto', required: true, tools: [...reviewBaseTools, 'send-message', 'set-status', 'finish_turn'] }),
    prepareGeneration: (_agent, input) => ({ ...input, mcpServers: utilityMcpServers(input.mcpServers).map(server => ({ ...server, approval: 'auto' as const, required: true })), selectModel: (models: readonly ProviderModelOption[]) => utilityTextModel('codex', models, input.complexity) }),
  });
}

/** The driver for a harness, with the options the daemon gives every harness. */
export function createProviderDriver(provider: HarnessProvider, options: Options = {}): AgentProviderDriver {
  if (provider === 'cursor') return createCursorDriver(options);
  if (provider === 'antigravity') return createAntigravityDriver(options);
  if (provider === 'claude') return createClaudeDriver({ ...options, homeDir: undefined });
  return createCodexDriver(options);
}
