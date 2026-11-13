import { providerSafetyBlockMessage } from './provider-safety-block';
import type { AgentStatus, AppSnapshot, SendPromptOptions } from './contracts';
import type { AgentProviderDriver, BackendEvent, ProviderSendResult } from './provider-driver';
import { providerDisplayName } from './provider-driver';
import { handoffInProgress } from './agent-handoff';
import { interactivePlanPrompt } from './plan-review';
import { bindUserDelegationOverrides, captureUserDelegationOverrides, isDelegationOverrides } from './delegation-context';

export type AgentChatEventEmitter = (
  event: BackendEvent,
) => void;

export type SendAgentPromptHooks = {
  /** Trusted delegated startup; uses the provider's native goal operation. */
  goal?: boolean;
  /** Backend-owned handoff transaction only; never exposed as a prompt option. */
  handoff?: boolean;
  /** Trusted guest admission: no product commands, exact owner-approved text. */
  plainText?: boolean;
  appendUserMessage?: boolean;
  onProviderSessionUpdated?: (result: ProviderSendResult, wasNewSession: boolean) => void | Promise<void>;
  onPromptFailed?: (error: Error) => void | Promise<void>;
  onPromptStarted?: (result: ProviderSendResult) => void | Promise<void>;
};

export function sendAgentPrompt(
  snapshot: AppSnapshot,
  providerDriver: AgentProviderDriver,
  agentId: string,
  prompt: string,
  options: SendPromptOptions | undefined,
  emit: AgentChatEventEmitter,
  hooks?: SendAgentPromptHooks,
): AppSnapshot {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (agent && handoffInProgress(agent) && !hooks?.handoff) throw new Error('Wait for the handoff to finish.');
  const trimmedPrompt = prompt.trim();
  const hasAttachments = (options?.attachments?.length ?? 0) > 0;
  if (!agent || (!trimmedPrompt && !hasAttachments) || isBusy(agent.status)) {
    return snapshot;
  }
  if (hooks?.goal && (!providerDriver.getCapabilities(agent).goals || !providerDriver.setGoal)) throw new Error('This backend does not support goals.');
  if (options?.delegation !== undefined && !isDelegationOverrides(options.delegation)) throw new Error('Invalid worktree delegation overrides.');

  agent.hasSubmittedPrompt = true;
  // Only app-submitted controls can override saved user preferences. Agent-
  // generated create-agent instructions never populate this field.
  const delegationControls = captureUserDelegationOverrides(agent, options?.delegation);
  const promptResult = hooks?.plainText || hooks?.goal ? null : providerDriver.tryHandlePromptCommand?.(agent, trimmedPrompt) ?? null;
  const hadProviderSession = Boolean(agent.providerSession);

  updateAgentStatus(agentId, { type: 'working' }, emit, snapshot);
  updateProviderRuntimeStatus({
    provider: providerDriver.provider,
    status: 'starting',
    detail: `Starting ${providerDisplayName(providerDriver.provider)} backend...`,
    capabilities: providerDriver.getCapabilities(agent),
  }, emit, snapshot);

  if (providerDriver.getCapabilities(agent).serviceTier && options?.selection?.serviceTier !== undefined) {
    const defaults = agent.providerDefaults?.kind === agent.provider
      ? agent.providerDefaults
      : { kind: agent.provider };
    agent.providerDefaults = { ...defaults, serviceTier: options.selection?.serviceTier };
  }
  const routedOptions = hooks?.appendUserMessage === false
    ? { ...options, recordUserMessage: false }
    : options;
  const preparedOptions = providerDriver.preparePromptOptions?.(agent, routedOptions) ?? routedOptions;
  const deliveredPrompt = hooks?.plainText ? prompt : options?.planMode === true && snapshot.general.useInteractivePlans !== false
    ? interactivePlanPrompt(trimmedPrompt) : trimmedPrompt;
  const sendResult = hooks?.goal
    ? providerDriver.setGoal!(agent, trimmedPrompt).then(result => {
      agent.providerSession = result.providerSession;
      if (result.goal) {
        agent.goal = result.goal;
        emit({ agentId, conversationId: result.goal.threadId, type: 'conversation.goalUpdated', payload: { goal: result.goal } });
      }
      return result;
    })
    : promptResult
    ?? (hasPromptOptions(preparedOptions)
      ? providerDriver.sendPrompt(agent, deliveredPrompt, preparedOptions)
      : providerDriver.sendPrompt(agent, deliveredPrompt));

  void sendResult
    .then((result) => {
      bindUserDelegationOverrides(agent, delegationControls, result);
      agent.provider = providerDriver.provider;
      agent.providerSession = result.providerSession;
      void Promise.resolve(hooks?.onProviderSessionUpdated?.(result, !hadProviderSession)).catch(() => undefined);
      updateProviderRuntimeStatus({
        provider: providerDriver.provider,
        status: 'running',
        detail: {
          key: 'backend.connected',
          params: { provider: providerDisplayName(providerDriver.provider) },
        },
        capabilities: providerDriver.getCapabilities(agent),
      }, emit, snapshot);
      void Promise.resolve(hooks?.onPromptStarted?.(result)).catch(() => undefined);
    })
    .catch((error) => {
      if (delegationControls && agent.userDelegationOverrides === delegationControls) delete agent.userDelegationOverrides;
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      const message = providerSafetyBlockMessage(normalizedError) ?? normalizedError.message;
      updateAgentStatus(agentId, { type: 'error', message }, emit, snapshot);
      updateProviderRuntimeStatus({
        provider: providerDriver.provider,
        status: 'error',
        detail: message,
      }, emit, snapshot);
      void Promise.resolve(hooks?.onPromptFailed?.(normalizedError)).catch(() => undefined);
    });

  return snapshot;
}

function hasPromptOptions(options: SendPromptOptions | undefined): options is SendPromptOptions {
  return Boolean(
    options?.content !== undefined ||
    options?.delegation ||
    (options?.attachments?.length ?? 0) > 0 ||
    options?.selection ||
    typeof options?.planMode === 'boolean' ||
    (options?.skills?.length ?? 0) > 0 ||
    options?.inputMethod ||
    options?.recordUserMessage === false ||
    options?.providerOptions,
  );
}

function isBusy(status: AgentStatus): boolean {
  return status.type === 'working' || status.type === 'awaitingInput';
}

function updateAgentStatus(
  agentId: string,
  status: AgentStatus,
  emit: AgentChatEventEmitter,
  snapshot: AppSnapshot,
): void {
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
  if (agent) {
    agent.status = status;
  }

  emit({
    agentId,
    type: 'agent.statusChanged',
    payload: status,
  });
}

function updateProviderRuntimeStatus(
  status: AppSnapshot['providerRuntimes'][number],
  emit: AgentChatEventEmitter,
  snapshot: AppSnapshot,
): void {
  const existingIndex = snapshot.providerRuntimes.findIndex((runtime) => runtime.provider === status.provider);
  if (existingIndex === -1) {
    snapshot.providerRuntimes.push(status);
  } else {
    snapshot.providerRuntimes[existingIndex] = status;
  }

  emit({
    provider: status.provider,
    type: 'provider.statusChanged',
    payload: status,
  });
}
