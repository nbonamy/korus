import { powerSaveBlocker } from 'electron';

type PowerSaveBlockerDependencies = {
  start: (type: 'prevent-display-sleep') => number;
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

  sync(shouldPreventDisplaySleep: boolean): void {
    if (shouldPreventDisplaySleep && this.blockerId === null) {
      this.blockerId = this.dependencies.start('prevent-display-sleep');
      return;
    }

    if (!shouldPreventDisplaySleep) {
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
