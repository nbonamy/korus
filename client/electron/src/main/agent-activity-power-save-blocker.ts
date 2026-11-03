import { powerSaveBlocker } from 'electron';

/** none: nothing held; suspension: keep the system running but let the display sleep and lock; display: also keep the screen on, so the session cannot idle-lock. */
export type PowerSaveLevel = 'none' | 'suspension' | 'display';

const blockerTypes = { suspension: 'prevent-app-suspension', display: 'prevent-display-sleep' } as const;
type PowerSaveBlockerType = (typeof blockerTypes)[Exclude<PowerSaveLevel, 'none'>];

type PowerSaveBlockerDependencies = {
  start: (type: PowerSaveBlockerType) => number;
  stop: (id: number) => void;
};

function defaultDependencies(): PowerSaveBlockerDependencies {
  return {
    start: (type) => powerSaveBlocker?.start?.(type) ?? -1,
    stop: (id) => powerSaveBlocker?.stop?.(id),
  };
}

/** Holds at most one native blocker, swapping it as the required protection changes. */
export class AgentActivityPowerSaveBlocker {
  private current: { id: number; level: Exclude<PowerSaveLevel, 'none'> } | null = null;

  constructor(private readonly dependencies: PowerSaveBlockerDependencies = defaultDependencies()) {}

  sync(level: PowerSaveLevel): void {
    if (this.current?.level === level) return;
    this.stop();
    if (level === 'none') return;
    this.current = { id: this.dependencies.start(blockerTypes[level]), level };
  }

  stop(): void {
    if (!this.current) return;
    this.dependencies.stop(this.current.id);
    this.current = null;
  }
}
