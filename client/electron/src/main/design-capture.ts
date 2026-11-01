import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { DesignCaptureInput } from '@workspace/core/design';

/** Disposable renderer: no preload, credentials, Node or app bridge. */
export async function captureDesign(input: DesignCaptureInput): Promise<string> {
  // Accepted documents contain up to 500k characters. HTML escaping and the
  // portable export's playback copy expand that representation before capture.
  if (!input || typeof input.html !== 'string' || input.html.length > 8_000_000
    || !Number.isInteger(input.width) || input.width < 240 || input.width > 3840
    || !Number.isInteger(input.height) || input.height < 160 || input.height > 3840) throw new Error('Invalid design capture.');
  const window = new BrowserWindow({ width: input.width, height: input.height, useContentSize: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, partition: `design-${randomUUID()}` } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const protocol = window.webContents.session.protocol;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'">`;
        const html = input.html.includes('<head>') ? input.html.replace('<head>', `<head>${policy}`) : policy + input.html;
        // Keep large documents out of navigation URLs and serve only this
        // capture's HTML from its disposable, credential-free session.
        protocol.handle('design-capture', () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
        await window.loadURL('design-capture://document');
        await window.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))])');
        const image = await window.webContents.capturePage();
        return image.toDataURL();
      })(),
      new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Design capture timed out.')), 10_000); }),
    ]);
  } finally {
    clearTimeout(deadline);
    if (!window.isDestroyed()) window.destroy();
    protocol.unhandle('design-capture');
  }
}
