import { describe, expect, it, vi } from 'vitest';
import type { KeyMonitorEvent } from 'autolib';
import { AppshotsKeyMonitor } from '../appshots-key-monitor';

// Device-dependent modifier bits carried by flagsChanged events.
const leftCommand = 0x100008;
const rightCommand = 0x100010;
const bothCommands = leftCommand | rightCommand;
const leftOption = 0x80020;
const rightOption = 0x80040;
const leftShift = 0x20002;
const rightShift = 0x20004;
const released = 0x100;

function nativeMonitor() {
  let listener: ((event: KeyMonitorEvent) => void) | null = null;
  return {
    emit(keyCode: number, flags = 0) {
      listener?.({ type: 'flagsChanged', keyCode, flags, isRepeat: false });
    },
    startModifierMonitor: vi.fn((callback: (event: KeyMonitorEvent) => void) => {
      listener = callback;
      return 0;
    }),
    stopModifierMonitor: vi.fn(() => {
      listener = null;
      return 0;
    }),
  };
}

describe('AppshotsKeyMonitor', () => {
  it('triggers once per chord when both command keys are held', () => {
    const native = nativeMonitor();
    const trigger = vi.fn();
    const monitor = new AppshotsKeyMonitor({ nativeMonitor: native, platform: 'darwin' });

    expect(monitor.start('command', trigger)).toBe(true);
    native.emit(55, leftCommand);
    expect(trigger).not.toHaveBeenCalled();
    native.emit(54, bothCommands);
    native.emit(54, leftCommand);
    native.emit(54, bothCommands);
    native.emit(55, released);
    native.emit(54, released);

    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('never triggers for a single command key, even after a missed key change', () => {
    const native = nativeMonitor();
    const trigger = vi.fn();
    const monitor = new AppshotsKeyMonitor({ nativeMonitor: native, platform: 'darwin' });

    monitor.start('command', trigger);
    // Global monitors are blind while the app itself is focused, so a press
    // or release can go unseen and leave the previous event stale.
    native.emit(55, leftCommand);
    native.emit(54, rightCommand);
    native.emit(54, released);
    native.emit(54, rightCommand);
    native.emit(55, leftCommand);

    expect(trigger).not.toHaveBeenCalled();
  });

  it('supports option and shift pairs', () => {
    const native = nativeMonitor();
    const trigger = vi.fn();
    const monitor = new AppshotsKeyMonitor({ nativeMonitor: native, platform: 'darwin' });

    monitor.start('option', trigger);
    native.emit(58, leftOption);
    native.emit(61, leftOption | rightOption);
    monitor.start('shift', trigger);
    native.emit(56, leftShift);
    native.emit(60, leftShift | rightShift);

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(native.stopModifierMonitor).toHaveBeenCalledTimes(1);
  });

  it('does not load the native monitor when disabled or unsupported', () => {
    const loadNativeMonitor = vi.fn(nativeMonitor);
    const trigger = vi.fn();
    const monitor = new AppshotsKeyMonitor({ loadNativeMonitor, platform: 'linux' });

    expect(monitor.start('command', trigger)).toBe(true);
    expect(loadNativeMonitor).not.toHaveBeenCalled();
    monitor.start('none', trigger);
    expect(loadNativeMonitor).not.toHaveBeenCalled();
  });

  it('reports a missing native modifier monitor as a startup failure', () => {
    const monitor = new AppshotsKeyMonitor({ nativeMonitor: {}, platform: 'darwin' });

    expect(monitor.start('command', vi.fn())).toBe(false);
    expect(() => monitor.stop()).not.toThrow();
  });

  it('reports native monitor startup failures', () => {
    const native = nativeMonitor();
    native.startModifierMonitor.mockReturnValue(3);
    const monitor = new AppshotsKeyMonitor({ nativeMonitor: native, platform: 'darwin' });

    expect(monitor.start('command', vi.fn())).toBe(false);
  });
});
