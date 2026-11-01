import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampAvatarCropPan, cropImageDataUrl } from '../agent-avatar-crop';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cropImageDataUrl', () => {
  it('crops the centered square into a png data url', async () => {
    const drawImage = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => 'data:image/png;base64,cropped',
        } as unknown as HTMLCanvasElement;
      }

      return createElement(tagName, options);
    }) as typeof document.createElement);
    stubImage({ height: 100, width: 200 });

    await expect(cropImageDataUrl('data:image/png;base64,source', 2)).resolves.toBe('data:image/png;base64,cropped');

    expect(drawImage).toHaveBeenCalledWith(
      expect.any(Object),
      75,
      25,
      50,
      50,
      0,
      0,
      128,
      128,
    );
  });

  it('applies pan offsets when cropping the source image', async () => {
    const drawImage = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toDataURL: () => 'data:image/png;base64,cropped',
        } as unknown as HTMLCanvasElement;
      }

      return createElement(tagName, options);
    }) as typeof document.createElement);
    stubImage({ height: 100, width: 200 });

    await expect(cropImageDataUrl('data:image/png;base64,source', 2, { x: 20, y: -10 }, 200)).resolves.toBe('data:image/png;base64,cropped');

    expect(drawImage).toHaveBeenCalledWith(
      expect.any(Object),
      70,
      27.5,
      50,
      50,
      0,
      0,
      128,
      128,
    );
  });

  it('clamps pan offsets to the available source crop area', () => {
    expect(clampAvatarCropPan({ x: 500, y: -500 }, { height: 300, width: 300 }, 3, 200)).toStrictEqual({
      x: 200,
      y: -200,
    });
  });

  it('returns the original source when canvas context is unavailable', async () => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => null,
        } as unknown as HTMLCanvasElement;
      }

      return createElement(tagName, options);
    }) as typeof document.createElement);
    stubImage({ height: 64, width: 64 });

    await expect(cropImageDataUrl('data:image/png;base64,source')).resolves.toBe('data:image/png;base64,source');
  });

  it('rejects when the source image cannot load', async () => {
    class FailingImage {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onerror?.();
      }
    }
    vi.stubGlobal('Image', FailingImage);

    await expect(cropImageDataUrl('broken')).rejects.toThrow('Unable to load avatar image.');
  });
});

function stubImage(dimensions: { height: number; width: number }): void {
  class TestImage {
    height = dimensions.height;
    naturalHeight = dimensions.height;
    naturalWidth = dimensions.width;
    onload: (() => void) | null = null;
    width = dimensions.width;
    set src(_value: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal('Image', TestImage);
}
