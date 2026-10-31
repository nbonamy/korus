import { expect, it, vi } from 'vitest';
import { captureDesign } from '../design-capture';
import { exportDesign, isDesignContent, type DesignContent } from '@workspace/core/design';
const fake = vi.hoisted(() => ({ options: {} as Record<string, any>, destroy: vi.fn(),
  loadURL: vi.fn(async (url: string) => { if (url.length > 2_000_000) throw new Error('ERR_INVALID_URL'); }),
  handle: vi.fn(), unhandle: vi.fn(), capture: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: class {
  constructor(options: Record<string, any>) { fake.options = options; }
  webContents = { session: { protocol: { handle: fake.handle, unhandle: fake.unhandle } }, setWindowOpenHandler: vi.fn(), on: vi.fn(), executeJavaScript: vi.fn(), capturePage: fake.capture };
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
  // Authored content fits the document limit; playback duplication and HTML
  // escaping can expand it substantially before it reaches the native host.
  const authoredAttributes: Record<string, string>[] = [
    { src: `data:image/png;base64,${'A'.repeat(90_000)}` },
    { title: '&'.repeat(99_000) },
  ];
  for (const attributes of authoredAttributes) {
    const content: DesignContent = { title: 'Gallery', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'root', tag: 'main', children: Array.from({ length: 5 }, (_, index) => ({ id: `image-${index}`, tag: 'img', attributes })) } }] };
    expect(isDesignContent(content)).toBe(true);
    const html = exportDesign(content);
    expect(html.length).toBeGreaterThan(600_000);
    fake.capture.mockResolvedValueOnce({ toDataURL: () => 'data:image/png;base64,YQ==' });
    expect(await captureDesign({ html, width: 800, height: 600 })).toBe('data:image/png;base64,YQ==');
  }
  await expect(captureDesign({ html: 'x'.repeat(8_000_001), width: 800, height: 600 })).rejects.toThrow('Invalid');
  await expect(captureDesign({ html: '<h1>Design</h1>', width: 100_000, height: 600 })).rejects.toThrow('Invalid');
});
