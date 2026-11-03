import { powerSaveBlocker } from 'electron';

type PowerSaveBlockerDependencies = {
  start: (type: 'prevent-app-suspension') => number;
  stop: (id: number) => void;
};

function defaultDependencies(): PowerSaveBlockerDependencies {
  return {
    start: (type) => powerSaveBlocker?.start?.(type) ?? -1,
    stop: (id) => powerSaveBlocker?.stop?.(id),
  };
}

export class AgentActivityPowerSaveBlocker {
  private blockerId: number | null = null;

  constructor(private readonly dependencies: PowerSaveBlockerDependencies = defaultDependencies()) {}

  sync(shouldPreventAppSuspension: boolean): void {
    if (shouldPreventAppSuspension && this.blockerId === null) {
      this.blockerId = this.dependencies.start('prevent-app-suspension');
      return;
    }

    if (!shouldPreventAppSuspension) {
      this.stop();
    }
  }

  stop(): void {
    if (this.blockerId === null) {
      return;
    }

    this.dependencies.stop(this.blockerId);
    this.blockerId = null;
  }
}
