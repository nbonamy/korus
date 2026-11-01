import type { AppshotHotkey } from '@workspace/core/contracts';
import type { Autolib, KeyMonitorEvent } from 'autolib';
import { loadNativeAutomation } from './native-automation';

// flagsChanged events carry device-dependent bits for each physical modifier
// key (NX_DEVICEL*KEYMASK / NX_DEVICER*KEYMASK). Reading them from every event
// keeps chord state exact even when events are missed: global monitors do not
// receive events while this app is focused.
const modifierPairs: Record<Exclude<AppshotHotkey, 'none'>, { keyCodes: readonly [number, number]; masks: readonly [number, number] }> = {
  command: { keyCodes: [55, 54], masks: [0x8, 0x10] },
  option: { keyCodes: [58, 61], masks: [0x20, 0x40] },
  shift: { keyCodes: [56, 60], masks: [0x2, 0x4] },
};

export type AppshotsKeyMonitorOptions = {
  loadNativeMonitor?: () => Pick<Autolib, 'startModifierMonitor' | 'stopModifierMonitor'>;
  nativeMonitor?: Pick<Autolib, 'startModifierMonitor' | 'stopModifierMonitor'>;
  platform?: NodeJS.Platform;
};

export class AppshotsKeyMonitor {
  private readonly loadNativeMonitor: () => Pick<Autolib, 'startModifierMonitor' | 'stopModifierMonitor'>;
  private nativeMonitor?: Pick<Autolib, 'startModifierMonitor' | 'stopModifierMonitor'>;
  private readonly platform: NodeJS.Platform;
  private hotkey: AppshotHotkey = 'none';
  private onTrigger: (() => void) | null = null;
  private running = false;
  private triggered = false;

  constructor(options: AppshotsKeyMonitorOptions = {}) {
    this.nativeMonitor = options.nativeMonitor;
    this.loadNativeMonitor = options.loadNativeMonitor ?? loadNativeAutomation;
    this.platform = options.platform ?? process.platform;
  }

  start(hotkey: AppshotHotkey, onTrigger: () => void): boolean {
    this.stop();
    this.hotkey = hotkey;
    this.onTrigger = onTrigger;
    if (this.platform !== 'darwin' || hotkey === 'none') return true;

    // Modifier changes reach an NSEvent global monitor without Input Monitoring,
    // unlike the CGEventTap behind startKeyMonitor. Older autolib builds lack it.
    this.nativeMonitor ??= this.loadNativeMonitor();
    const result = this.nativeMonitor.startModifierMonitor?.((event) => this.handleEvent(event));
    this.running = result === 0;
    return this.running;
  }

  stop(): void {
    if (this.running) this.nativeMonitor?.stopModifierMonitor?.();
    this.running = false;
    this.hotkey = 'none';
    this.onTrigger = null;
    this.triggered = false;
  }

  private handleEvent(event: KeyMonitorEvent): void {
    if (event.type !== 'flagsChanged' || this.hotkey === 'none') return;
    const pair = modifierPairs[this.hotkey];
    if (!pair.keyCodes.includes(event.keyCode)) return;

    const chordHeld = pair.masks.every((mask) => (event.flags & mask) !== 0);
    if (chordHeld && !this.triggered) {
      this.triggered = true;
      this.onTrigger?.();
    } else if (!chordHeld) {
      this.triggered = false;
    }
  }
}
