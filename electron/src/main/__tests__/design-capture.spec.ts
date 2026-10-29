import { expect, it, vi } from 'vitest';
import { captureDesign } from '../design-capture';
const fake = vi.hoisted(() => ({ options: {} as Record<string, any>, destroy: vi.fn(), loadURL: vi.fn(), capture: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: class {
  constructor(options: Record<string, any>) { fake.options = options; }
  webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: vi.fn(), capturePage: fake.capture };
  loadURL = fake.loadURL;
  destroy = fake.destroy;
  isDestroyed = () => false;
} }));
// Native boundary failures: generated content inherits app authority, or a failed
// capture leaks a hidden renderer. Render isolation is exercised in the E2E workflow.
it('captures a bounded isolated document and disposes the native window on success and failure', async () => {
  fake.capture.mockResolvedValueOnce({ toDataURL: () => 'data:image/png;base64,YQ==' });
  expect(await captureDesign({ html: '<!doctype html><h1>Design</h1>', width: 800, height: 600 })).toBe('data:image/png;base64,YQ==');
  expect(fake.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  expect(fake.options.show).toBe(false);
  expect(fake.destroy).toHaveBeenCalledTimes(1);
  fake.capture.mockRejectedValueOnce(new Error('Capture failed'));
  await expect(captureDesign({ html: '<h1>Design</h1>', width: 800, height: 600 })).rejects.toThrow('Capture failed');
  expect(fake.destroy).toHaveBeenCalledTimes(2);
  await expect(captureDesign({ html: '<h1>Design</h1>', width: 100_000, height: 600 })).rejects.toThrow('Invalid');
});
