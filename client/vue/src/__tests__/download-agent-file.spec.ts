import { afterEach, describe, expect, it, vi } from 'vitest';
import { setElectronTestClient } from '../test/client';
import { downloadAgentFile } from '../download-agent-file';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('agent file downloads', () => {
  it('assembles bytes in order and starts a named download, then releases its URL', async () => {
    vi.useFakeTimers();
    const readAgentFileChunk = vi.fn()
      .mockResolvedValueOnce({ path: 'film.mp4', size: 4, data: 'AAE=', nextOffset: 2 })
      .mockResolvedValueOnce({ path: 'film.mp4', size: 4, data: 'Av8=', nextOffset: 4 });
    setElectronTestClient({ readAgentFileChunk });
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('film.mp4');
      expect(this.href).toBe('blob:download');
      expect(this.isConnected).toBe(true);
    });
    await downloadAgentFile('remote-agent', 'videos/film.mp4');
    expect(readAgentFileChunk.mock.calls).toEqual([
      ['remote-agent', 'videos/film.mp4', 0], ['remote-agent', 'videos/film.mp4', 2],
    ]);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.size).toBe(4);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    expect([...new Uint8Array(bytes)]).toEqual([0, 1, 2, 255]);
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('rejects an interrupted transfer instead of downloading a truncated file', async () => {
    setElectronTestClient({ readAgentFileChunk: vi.fn().mockResolvedValue({ path: 'film.mp4', size: 4, data: '', nextOffset: 0 }) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(downloadAgentFile('agent', 'film.mp4')).rejects.toThrow('before completion');
    expect(click).not.toHaveBeenCalled();
  });
});
