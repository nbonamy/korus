import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const electron = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  showItemInFolder: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/logs'), getVersion: vi.fn(() => '0.50.6'), getAppMetrics: vi.fn(() => [{ pid: 1 }]) },
  dialog: { showMessageBox: electron.showMessageBox },
  shell: { showItemInFolder: electron.showItemInFolder },
}));
const capture = vi.hoisted(() => vi.fn());
vi.mock('../performance-profile', () => ({ capturePerformanceProfile: capture }));
import { runPerformanceCapture } from '../performance-capture-dialog';

const window = () => ({ isDestroyed: () => false, webContents: { debugger: { id: 'debugger' } } }) as unknown as BrowserWindow;

beforeEach(() => { vi.clearAllMocks(); capture.mockResolvedValue({ directory: '/logs/profiles', cpuProfilePath: '/logs/profiles/cpu.cpuprofile' }); });

describe('runPerformanceCapture', () => {
  it('records for ten seconds into the logs folder and reveals the result on request', async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    await runPerformanceCapture(window());
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ directory: '/logs/profiles', durationMs: 10_000, includeHeapSnapshot: false, appVersion: '0.50.6' }));
    expect(electron.showItemInFolder).toHaveBeenCalledWith('/logs/profiles/cpu.cpuprofile');
  });

  it('adds a memory snapshot only when that button is chosen', async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 1 });
    await runPerformanceCapture(window());
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ includeHeapSnapshot: true }));
    expect(electron.showItemInFolder).not.toHaveBeenCalled();
  });

  it('records nothing when cancelled', async () => {
    electron.showMessageBox.mockResolvedValueOnce({ response: 2 });
    await runPerformanceCapture(window());
    expect(capture).not.toHaveBeenCalled();
  });

  it('tells the user when the capture fails', async () => {
    capture.mockRejectedValueOnce(new Error('Another debugger is already attached'));
    electron.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    await runPerformanceCapture(window());
    expect(electron.showMessageBox).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ type: 'error', detail: 'Another debugger is already attached' }));
  });
});
