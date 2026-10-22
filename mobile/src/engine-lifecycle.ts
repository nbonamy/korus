import { connectionDiagnostic } from './connection-diagnostics';

type Options = {
  graceMs: number;
  /** Stops the transport; resumed later by the connector itself when the app is used again. */
  suspend(): Promise<void> | void;
};

/**
 * How long the app may be away before its connection is given up. The authenticated link survives quick app
 * switches; past the grace period the transport is stopped so a long-hidden app holds no sockets.
 */
export function createLifecycle(options: Options) {
  let leftAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  let suspension: Promise<void> | undefined;

  function suspend() {
    if (suspended) return suspension;
    suspended = true;
    connectionDiagnostic('app.background-grace-expired');
    suspension = Promise.resolve(options.suspend());
    return suspension;
  }

  return {
    /** The app went to the background; only the first departure of an absence starts the clock. */
    left(stillAway: () => boolean) {
      if (leftAt !== undefined) return;
      leftAt = Date.now();
      timer = setTimeout(() => { timer = undefined; if (stillAway()) void suspend()?.catch(() => {}); }, options.graceMs);
    },
    /**
     * The app came back. The absence is forgotten at once, so leaving again while this is still resolving starts a
     * fresh grace period. Resolves when any suspension the absence caused has finished.
     */
    async returned() {
      clearTimeout(timer); timer = undefined;
      if (leftAt !== undefined && Date.now() - leftAt >= options.graceMs) suspend();
      leftAt = undefined;
      await suspension?.catch(() => {});
      suspension = undefined;
    },
    /** The connector is running again after a suspension. */
    resumed() { suspended = false; },
    dispose() { clearTimeout(timer); timer = undefined; },
  };
}
