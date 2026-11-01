import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  annotationAnchor,
  annotationCounterPlacement,
  annotationPixelLength,
  centeredImageCropDataUrl,
  centeredImageCropRect,
  formatImageAnnotationPrompt,
  isDrawableAnnotation,
  measurementAnnotation,
  type ImageAnnotation,
} from '../image-annotation';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('image annotation geometry', () => {
  it('formats every numbered image annotation after an existing composer prompt', () => {
    expect(formatImageAnnotationPrompt([{
      imageNumber: 1,
      fileName: 'home.png',
      annotations: [
        {
          id: 'first',
          number: 1,
          tool: 'arrow',
          start: { x: 1, y: 2 },
          end: { x: 3, y: 4 },
          comment: 'Move this control.',
        },
        {
          id: 'second',
          number: 2,
          tool: 'rectangle',
          start: { x: 5, y: 6 },
          end: { x: 7, y: 8 },
          comment: '  Increase the spacing.  ',
        },
      ],
    }, {
      imageNumber: 2,
      fileName: 'settings.png',
      annotations: [{
        id: 'third',
        number: 1,
        tool: 'oval',
        start: { x: 9, y: 10 },
        end: { x: 11, y: 12 },
        comment: 'Rename this section.',
      }],
    }], 'Please update these screens.')).toBe([
      'Please update these screens.',
      '',
      'Image annotations:',
      '',
      'Image 1 — home.png',
      '1. Move this control.',
      '2. Increase the spacing.',
      '',
      'Image 2 — settings.png',
      '1. Rename this section.',
    ].join('\n'));
  });

  it('describes a measurement without a comment by its pixel length, honouring Retina scale', () => {
    const measure = (tool: 'measure-horizontal' | 'measure-vertical', comment: string, id: string, number: number): ImageAnnotation => ({
      id, number, tool, comment, start: tool === 'measure-horizontal' ? { x: 10, y: 5 } : { x: 5, y: 10 },
      end: tool === 'measure-horizontal' ? { x: 59, y: 5 } : { x: 5, y: 59 } });
    expect(formatImageAnnotationPrompt([{ imageNumber: 1, fileName: 'home.png', pixelRatio: 2, annotations: [
      measure('measure-horizontal', '', 'first', 1),
      measure('measure-vertical', '  Too tall.  ', 'second', 2),
      measure('measure-vertical', '', 'third', 3),
    ] }])).toBe([
      'Image annotations:', '', 'Image 1 — home.png',
      '1. Horizontal gap: 24px', '2. Too tall.', '3. Vertical gap: 24px',
    ].join('\n'));
  });

  it('omits the empty-instructions placeholder when only image annotations are submitted', () => {
    expect(formatImageAnnotationPrompt([{
      imageNumber: 1,
      fileName: 'image.png',
      annotations: [{
        id: 'first',
        number: 1,
        tool: 'arrow',
        start: { x: 1, y: 2 },
        end: { x: 3, y: 4 },
        comment: 'Move this control.',
      }],
    }], '(no user instructions)')).toBe([
      'Image annotations:',
      '',
      'Image 1 — image.png',
      '1. Move this control.',
    ].join('\n'));
  });

  it('measures the gap between contrasting horizontal edges', () => {
    const imageData = solidImageData(11, 3, 255);
    paintColumn(imageData, 1, 0);
    paintColumn(imageData, 2, 0);
    paintColumn(imageData, 8, 0);
    paintColumn(imageData, 9, 0);

    const measurement = measurementAnnotation(
      imageData,
      { x: 5, y: 1 },
      'measure-horizontal',
      imageData.width,
      imageData.height,
    );
    const annotation: ImageAnnotation = {
      ...measurement,
      id: 'gap',
      number: 1,
      comment: '',
    };

    expect(measurement.start).toStrictEqual({ x: 2, y: 1 });
    expect(measurement.end).toStrictEqual({ x: 8, y: 1 });
    expect(annotationPixelLength(annotation)).toBe(5);
    expect(annotationPixelLength(annotation, 2)).toBe(2.5);
    expect(annotationAnchor(annotation)).toStrictEqual({ x: 8, y: 1 });
    expect(annotationCounterPlacement(annotation)).toStrictEqual({
      anchor: { x: 5, y: 1 },
      center: { x: 5, y: 24 },
    });
    expect(annotationAnchor({
      ...annotation,
      tool: 'arrow',
      start: { x: 2, y: 4 },
      end: { x: 9, y: 7 },
    })).toStrictEqual({ x: 9, y: 7 });
  });

  it('excludes both detected borders from the measured gap', () => {
    const annotation: ImageAnnotation = {
      id: 'vertical-gap',
      number: 1,
      tool: 'measure-vertical',
      start: { x: 12, y: 20 },
      end: { x: 12, y: 93 },
      comment: '',
    };

    expect(annotationPixelLength(annotation)).toBe(72);
    expect(annotationAnchor(annotation)).toStrictEqual(annotation.end);
    expect(annotationCounterPlacement(annotation)).toStrictEqual({
      anchor: { x: 12, y: 56.5 },
      center: { x: -11, y: 56.5 },
    });
  });

  it('places an arrow counter behind its tail', () => {
    const annotation: ImageAnnotation = {
      id: 'arrow',
      number: 1,
      tool: 'arrow',
      start: { x: 10, y: 10 },
      end: { x: 30, y: 10 },
      comment: '',
    };

    expect(annotationCounterPlacement(annotation)).toStrictEqual({
      anchor: { x: 30, y: 10 },
      center: { x: 53, y: 10 },
    });
  });

  it('measures to image boundaries when pixel data is unavailable', () => {
    expect(measurementAnnotation(null, { x: 4, y: 6 }, 'measure-vertical', 10, 20)).toStrictEqual({
      tool: 'measure-vertical',
      start: { x: 4, y: 0 },
      end: { x: 4, y: 19 },
    });
  });

  it('snaps to a thin low-contrast separator instead of skipping to the image boundary', () => {
    const imageData = solidImageData(15, 14, 255);
    paintRow(imageData, 2, 90, 4, 10);
    paintRow(imageData, 3, 90, 4, 10);
    paintRow(imageData, 9, 242);

    expect(measurementAnnotation(
      imageData,
      { x: 7, y: 6 },
      'measure-vertical',
      imageData.width,
      imageData.height,
    )).toStrictEqual({
      tool: 'measure-vertical',
      start: { x: 7, y: 3 },
      end: { x: 7, y: 9 },
    });
  });

  it('ignores gradual shadows and snaps to the abrupt boundary after them', () => {
    const imageData = solidImageData(15, 22, 255);
    paintRow(imageData, 2, 80, 4, 10);
    paintRow(imageData, 3, 80, 4, 10);
    for (let y = 8; y < 18; y += 1) paintRow(imageData, y, 255 - (y - 7) * 2);
    paintRow(imageData, 18, 195);

    expect(measurementAnnotation(
      imageData,
      { x: 7, y: 6 },
      'measure-vertical',
      imageData.width,
      imageData.height,
    )).toStrictEqual({
      tool: 'measure-vertical',
      start: { x: 7, y: 3 },
      end: { x: 7, y: 18 },
    });
  });

  it('rejects accidental clicks but accepts meaningful marks', () => {
    const annotation: ImageAnnotation = {
      id: 'shape',
      number: 1,
      tool: 'rectangle',
      start: { x: 10, y: 10 },
      end: { x: 12, y: 12 },
      comment: '',
    };

    expect(isDrawableAnnotation(annotation)).toBe(false);
    expect(isDrawableAnnotation({ ...annotation, end: { x: 40, y: 50 } })).toBe(true);
  });

  it('crops fallback screenshots around their center', () => {
    expect(centeredImageCropRect(1000, 600, 0.72)).toStrictEqual({
      x: 140,
      y: 84,
      width: 720,
      height: 432,
    });
  });

  it('rejects a fallback screenshot that never finishes loading', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', class {
      crossOrigin = '';
      onerror: OnErrorEventHandler | null = null;
      onload: ((event: Event) => unknown) | null = null;
      set src(_source: string) {}
    });

    const crop = centeredImageCropDataUrl('stalled-fixture.png');
    const rejection = expect(crop).rejects.toThrow('Timed out loading the image annotation fixture.');
    await vi.advanceTimersByTimeAsync(1_200);
    await rejection;
  });

});

function solidImageData(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function paintColumn(imageData: ImageData, x: number, value: number): void {
  for (let y = 0; y < imageData.height; y += 1) {
    const index = (y * imageData.width + x) * 4;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
}

function paintRow(imageData: ImageData, y: number, value: number, startX = 0, endX = imageData.width - 1): void {
  for (let x = startX; x <= endX; x += 1) {
    const index = (y * imageData.width + x) * 4;
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
}
