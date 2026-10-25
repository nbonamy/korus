export type FirstRunOnboardingStage = 'providers' | 'repositories' | 'complete';

const firstRunOnboardingStageKey = 'app:firstRunOnboardingStage';

export function getFirstRunOnboardingStage(): FirstRunOnboardingStage | null {
  const saved = globalThis.localStorage?.getItem(firstRunOnboardingStageKey)
    ?? globalThis.sessionStorage?.getItem(firstRunOnboardingStageKey);
  const stage = saved === 'github' ? 'repositories' : saved;
  if (stage !== 'providers' && stage !== 'repositories' && stage !== 'complete') return null;
  setFirstRunOnboardingStage(stage);
  return stage;
}

export function setFirstRunOnboardingStage(stage: FirstRunOnboardingStage): void {
  globalThis.localStorage?.setItem(firstRunOnboardingStageKey, stage);
  globalThis.sessionStorage?.setItem(firstRunOnboardingStageKey, stage);
}

export function clearFirstRunOnboardingStage(): void {
  globalThis.localStorage?.removeItem(firstRunOnboardingStageKey);
  globalThis.sessionStorage?.removeItem(firstRunOnboardingStageKey);
}

export function isFirstRunOnboardingActive(): boolean {
  return getFirstRunOnboardingStage() !== null;
}
