import { describe, expect, it, vi } from 'vitest';
import { detectPngRetinaPixelRatio, readClipboardPngBuffer } from '../clipboard-image';

describe('clipboard image metadata', () => {
  it('detects the 144 DPI metadata emitted by macOS Retina screenshots', () => {
    expect(detectPngRetinaPixelRatio(pngWithDensity(5_669, 5_669))).toBe(2);
  });

  it('does not treat ordinary or print-resolution PNGs as Retina screenshots', () => {
    expect(detectPngRetinaPixelRatio(pngWithDensity(2_835, 2_835))).toBeUndefined();
    expect(detectPngRetinaPixelRatio(pngWithDensity(11_811, 11_811))).toBeUndefined();
  });

  it('rejects invalid metadata without reading beyond the PNG buffer', () => {
    expect(detectPngRetinaPixelRatio(Buffer.from('not a png'))).toBeUndefined();
    expect(detectPngRetinaPixelRatio(pngWithDensity(5_669, 5_669, 0))).toBeUndefined();
  });

  it('falls back to the native macOS alias when Electron advertises an empty image/png buffer', () => {
    const png = pngWithDensity(5_669, 5_669);
    const clipboard = {
      availableFormats: vi.fn(() => ['image/png']),
      readBuffer: vi.fn((format: string) => format === 'public.png' ? png : Buffer.alloc(0)),
    };

    expect(readClipboardPngBuffer(clipboard)).toBe(png);
    expect(clipboard.readBuffer).toHaveBeenCalledWith('image/png');
    expect(clipboard.readBuffer).toHaveBeenCalledWith('public.png');
  });
});

function pngWithDensity(xPixelsPerMeter: number, yPixelsPerMeter: number, unit = 1): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = Buffer.alloc(21);
  chunk.writeUInt32BE(9, 0);
  chunk.write('pHYs', 4, 'ascii');
  chunk.writeUInt32BE(xPixelsPerMeter, 8);
  chunk.writeUInt32BE(yPixelsPerMeter, 12);
  chunk[16] = unit;
  return Buffer.concat([signature, chunk]);
}
