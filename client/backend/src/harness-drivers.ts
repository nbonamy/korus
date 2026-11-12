import { createHarness, type HarnessOptions } from '@korus-dev/multi-agent-sdk';
import { isBookkeepingTool } from '@workspace/core/bookkeeping-tools';
import type { Agent, HarnessProvider, ProviderModelOption } from '@workspace/core/contracts';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { agentDisplayName } from '@workspace/core/agent-display';
import { shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import { product } from '@workspace/core/product';
import type { ProviderDriverRegistryOptions } from './driver-rpc';
import { AgentRegistry, HarnessAgentDriver, type DriverPolicy } from './harness-agent-driver';
import { agentScopedMcpUrl, appMcpUrlForAgent, buildAppMcpConfigOverrides, buildAppThreadExtras } from './mcp/codex-config';
import { appDeveloperInstructions } from './mcp/agent-prompts';
import { promptWithSelectedReferences } from './agents/prompt-content';
import { utilityTextModel } from './agents/utility-text-model';
import { utilityMcpServers } from './diagram-icons/utility-mcp';
import { plainTextGenerationPrompt } from './agents/prompts';
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
const planOnly = '\nWrite the plan and stop. Do not implement it or request implementation approval in this turn; Korus will collect the decision after showing the plan.';

/** App identity, instructions and MCP wiring shared by every provider. */
function common(options: Options, agents: AgentRegistry): Pick<HarnessOptions, 'client' | 'stateDirectory' | 'formatPrompt' | 'trustedMcpServerName' | 'isBookkeepingTool' | 'instructions' | 'mcpServers' | 'log'> {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  return {
    client: { name: product.mcpServerName, title: product.name, metadataDirectory: 'korus-sessions', temporaryDirectory: 'korus-tmp' },
    stateDirectory: backendHomeDir,
    formatPrompt: promptWithSelectedReferences,
    trustedMcpServerName: product.mcpServerName,
    isBookkeepingTool,
    instructions: (context, { planMode }) => {
      const agent = agents.get(context.id);
      return appDeveloperInstructions(agent, options.pluginSettings?.() ?? settings()?.plugins,
        { celebrationsEnabled: options.celebrationsEnabled?.() ?? settings()?.celebrationsEnabled, developerInstructions: options.additionalDeveloperInstructions?.(agent) }) + (planMode ? planOnly : '');
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

/** What every reviewer may call on Korus's server: its skills, the review ledger, and messages to the agent it reviews. */
const reviewTools = ['read-skill', 'report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'send-message', 'set-status', 'finish_turn'] as const;
/**
 * The scope a code review runs in, the same for every harness: Korus's review tools on its own MCP server, trusted and
 * required wherever the harness can express that.
 */
export const reviewScope = (provider: HarnessProvider) => (url: string) => {
  const { mcpAutoApproval, mcpRequiredServers } = defaultProviderCapabilities(provider);
  return { id: url, mcpServers: [{ name: product.mcpServerName, url, ...(mcpAutoApproval ? { approval: 'auto' as const } : {}), ...(mcpRequiredServers ? { required: true } : {}), enabledTools: [...reviewTools] }] } as never;
};

/** Every harness gets the same review scope and generation preparation; a harness adds only what is its own. */
const driver = (provider: Agent['provider'], harness: ReturnType<typeof createHarness>, agents: AgentRegistry, policy: Omit<DriverPolicy, 'agents' | 'displayName' | 'reviewScope' | 'prepareGeneration'> = {}) =>
  new HarnessAgentDriver(provider, harness, { agents, displayName: agentDisplayName, reviewScope: reviewScope(provider), prepareGeneration: prepareGeneration(provider), ...policy });

function createCursorDriver(options: Options = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const agents = new AgentRegistry();
  const home = settings()?.providerHomes?.cursor;
  const harness = make('cursor', { ...common(options, agents),
    ...(home?.isolated ? { home: home.homePath } : {}),
    cursor: { command: resolveCursorExecutable, steeringFallback: () => settings()?.cursorSteeringFallbackEnabled === true },
  });
  return driver('cursor', harness, agents, {
    coordinationPolicy: { authentication: { actions: ['check', 'cancel', 'logout', 'login'] } },
  });
}

/**
 * A background generation, prepared the same way for every harness from what the harness can do: its own server is
 * trusted and required where that can be expressed, and a harness without structured output is asked in words instead.
 */
export const prepareGeneration = (provider: HarnessProvider): NonNullable<DriverPolicy['prepareGeneration']> => (_agent, input) => {
  const { mcpAutoApproval, mcpRequiredServers, structuredOutput } = defaultProviderCapabilities(provider);
  const mcpServers = utilityMcpServers(input.mcpServers).map(server => ({ ...server, ...(mcpAutoApproval ? { approval: 'auto' as const } : {}), ...(mcpRequiredServers ? { required: true } : {}) }));
  const selectModel = (models: readonly ProviderModelOption[]) => utilityTextModel(provider, models, input.complexity);
  if (structuredOutput) return { ...input, mcpServers, selectModel } as never;
  const { outputSchema, developerInstructions, ...rest } = input;
  return { ...rest, mcpServers, selectModel, prompt: plainTextGenerationPrompt({ developerInstructions, prompt: input.prompt, outputSchema, hasMcpServers: mcpServers.length > 0 }) } as never;
};

export function createAntigravityDriver(options: Options = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const agents = new AgentRegistry();
  const home = (options.getGeneralSettings?.() ?? options.generalSettings)?.providerHomes?.antigravity;
  const harness = make('antigravity', { ...common(options, agents),
    ...(home ? { home: home.homePath } : {}),
    antigravity: { command: process.env.APP_ANTIGRAVITY_COMMAND },
  });
  return driver('antigravity', harness, agents, {
    coordinationPolicy: { authentication: { actions: ['check', 'cancel', 'logout', 'login'] } },
  });
}

export function createClaudeDriver(options: Options & { homeDir?: string } = {}, make: HarnessFactory = realHarness): HarnessAgentDriver {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const agents = new AgentRegistry();
  const harness = make('claude', { ...common(options, agents),
    client: { name: product.name, title: product.name, metadataDirectory: 'korus-sessions', entrypoint: product.slug, clientApp: 'agent-workspace' },
    ...(options.homeDir ? { home: options.homeDir } : {}),
    claude: { launch: (command, env) => resolveClaudeLaunch(command, env), decideTool: tool => tool === 'ExitPlanMode' ? { behavior: 'deny' as const, message: `${product.name} captured the proposed plan. Wait for the user to review or request implementation.` } : undefined, disallowedTools: ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'] },
  });
  void settings;
  return driver('claude', harness, agents);
}

/** The Harness options Korus runs Codex with. */
export function codexHarnessOptions(options: Options, agents: AgentRegistry): HarnessOptions {
  const settings = () => options.getGeneralSettings?.() ?? options.generalSettings;
  const base = common(options, agents);
  return {
    client: { name: 'workspace', title: product.name, version: '0.3.0', metadataDirectory: base.client.metadataDirectory },
    formatPrompt: base.formatPrompt, trustedMcpServerName: product.mcpServerName, log: base.log,
    instructions: base.instructions, mcpServers: base.mcpServers,
    home: settings()?.providerHomes?.codex?.homePath ?? backendCodexHomeDir(),
    onDiagnostic: traceCodexDiagnostic,
    codex: {
      launch: resolveCodexLaunch(settings()?.codexBinaryPath),
      config: ['features.default_mode_request_user_input=true', ...buildAppMcpConfigOverrides(options.pluginSettings?.() ?? settings()?.plugins)],
      defaultModel: codexConversationDefaults,
      conversationConfig: (context, scope) => {
        // Instructions and MCP servers reach Codex through the options every harness shares, and a scope such as a
        // review brings its own servers. Only the keys Codex alone has are set here.
        if (!scope?.mcpServerUrl && !options.appMcpServerUrl) return {} as never;
        return buildAppThreadExtras(options.pluginSettings?.() ?? settings()?.plugins, scope?.mcpServerUrl ? {} : options.hostedMcpServerUrls?.() ?? {}) as never;
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
  });
}

/** The driver for a harness, with the options the daemon gives every harness. */
export function createProviderDriver(provider: HarnessProvider, options: Options = {}): AgentProviderDriver {
  if (provider === 'cursor') return createCursorDriver(options);
  if (provider === 'antigravity') return createAntigravityDriver(options);
  if (provider === 'claude') return createClaudeDriver({ ...options, homeDir: undefined });
  return createCodexDriver(options);
}
