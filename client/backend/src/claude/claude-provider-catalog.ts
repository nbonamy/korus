import { claudeWorkingDirectory } from './working-directory';
import { claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { BackendEvent, BackendPermissionModeResult } from '@workspace/core/backend-driver';
import type {
  Agent,
  BackendCapabilities,
  BackendModelOption,
  BackendRuntimeStatus,
  BackendSkillSummary,
} from '@workspace/core/contracts';
import { claudeModelOptions, claudeModelOptionsFromSdk } from './models';
import { listClaudeSkills } from './skills';
import type { ClaudeAvailableModel, ClaudeTurnTransport } from './transport';

export type ClaudeProviderCatalogOptions = {
  homeDir?: string;
  emit: (event: BackendEvent) => void;
  transport: ClaudeTurnTransport;
};

/** Owns Claude runtime capabilities, models, skills, and persisted defaults. */
export class ClaudeProviderCatalog {
  private modelCatalog = claudeModelOptions.map((model) => ({ ...model }));
  private modelCatalogDiscovery: Promise<void> | null = null;

  constructor(private readonly options: ClaudeProviderCatalogOptions) {}

  getRuntimeStatus(): BackendRuntimeStatus {
    return {
      backend: 'claude',
      status: 'notConfigured',
      detail: { key: 'backend.claudeNotStarted' },
    };
  }

  getCapabilities(): BackendCapabilities {
    return {
      ...claudeBackendCapabilities,
      reasoningEffort: this.modelCatalog.some((model) => (model.supportedReasoningEfforts?.length ?? 0) > 0),
      serviceTier: this.modelCatalog.some((model) => (model.serviceTiers?.length ?? 0) > 0),
    };
  }

  async listModels(agent: Agent): Promise<BackendModelOption[]> {
    await this.discoverModels(agent);
    return this.modelCatalog.map((model) => ({ ...model }));
  }

  async listSkills(agent: Agent): Promise<BackendSkillSummary[]> {
    return listClaudeSkills(agent, { homeDir: this.options.homeDir });
  }

  setPermissionMode(agent: Agent, mode: string): BackendPermissionModeResult {
    const defaults = agent.backendDefaults?.kind === 'claude'
      ? agent.backendDefaults
      : { kind: 'claude' as const };
    return {
      backendDefaults: {
        ...defaults,
        permissionMode: mode,
      },
    };
  }

  async refreshModels(): Promise<void> {
    const availableModels = await this.options.transport.listModels?.();
    if (availableModels?.length) this.applyModels(availableModels);
  }

  private async discoverModels(agent: Agent): Promise<void> {
    if (!this.options.transport.discoverModels || this.modelCatalogDiscovery) {
      await this.modelCatalogDiscovery;
      return;
    }
    const discovery = this.options.transport.discoverModels({ cwd: claudeWorkingDirectory(agent) })
      .then((availableModels) => {
        if (availableModels?.length) this.applyModels(availableModels);
      })
      .catch(() => undefined);
    this.modelCatalogDiscovery = discovery;
    try {
      await discovery;
    } finally {
      if (this.modelCatalogDiscovery === discovery) this.modelCatalogDiscovery = null;
    }
  }

  private applyModels(availableModels: readonly ClaudeAvailableModel[]): void {
    const models = claudeModelOptionsFromSdk(availableModels);
    if (!models.length || sameModelCatalog(this.modelCatalog, models)) return;
    this.modelCatalog = models;
    this.options.emit({
      backend: 'claude',
      type: 'models.changed',
      payload: { models: this.modelCatalog.map((model) => ({ ...model })) },
    });
    this.options.emit({
      backend: 'claude',
      type: 'backend.statusChanged',
      payload: {
        backend: 'claude',
        status: 'running',
        detail: { key: 'backend.claudeConnected' },
        capabilities: this.getCapabilities(),
      },
    });
  }
}

function sameModelCatalog(left: readonly BackendModelOption[], right: readonly BackendModelOption[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
