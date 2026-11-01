
import { translate } from '../i18n';

export type ImageAnnotationTool =
  | 'arrow'
  | 'oval'
  | 'rectangle'
  | 'measure-horizontal'
  | 'measure-vertical';

export type ImageAnnotationPoint = {
  x: number;
  y: number;
};

export type ImageAnnotation = {
  id: string;
  number: number;
  tool: ImageAnnotationTool;
  start: ImageAnnotationPoint;
  end: ImageAnnotationPoint;
  comment: string;
};

export type SavedImageAnnotations = {
  annotations: ImageAnnotation[];
  dataUrl: string;
  fileName: string;
  height: number;
  pixelRatio: 1 | 2;
  width: number;
};

export type ImageAnnotationPromptGroup = {
  annotations: readonly ImageAnnotation[];
  fileName: string;
  imageNumber: number;
  pixelRatio?: number;
};

export type ImageAnnotationPalette = {
  stroke: string;
  halo: string;
  labelFill: string;
  labelText: string;
};

export type ImageAnnotationCounterPlacement = {
  anchor: ImageAnnotationPoint;
  center: ImageAnnotationPoint;
};

export function formatImageAnnotationPrompt(
  groups: readonly ImageAnnotationPromptGroup[],
  existingPrompt = '',
): string {
  const prompt = existingPrompt.trim() === '(no user instructions)' ? '' : existingPrompt.trim();
  const annotationText = [
    'Image annotations:',
    '',
    ...groups.flatMap((group, index) => [
      `Image ${group.imageNumber} — ${group.fileName}`,
      ...group.annotations.map((annotation) => `${annotation.number}. ${annotationPromptText(annotation, group.pixelRatio)}`),
      ...(index === groups.length - 1 ? [] : ['']),
    ]),
  ].join('\n');
  return [prompt, annotationText].filter(Boolean).join('\n\n');
}

/** A measurement needs no comment: its length is the instruction. */
function annotationPromptText(annotation: ImageAnnotation, pixelRatio?: number): string {
  const comment = annotation.comment.trim();
  const length = annotationPixelLength(annotation, pixelRatio);
  if (comment || length === null) return comment;
  return `${annotation.tool === 'measure-horizontal' ? 'Horizontal' : 'Vertical'} gap: ${length}px`;
}

export const defaultImageAnnotationPalette: ImageAnnotationPalette = {
  stroke: '#ff2d20',
  halo: '#ffffff',
  labelFill: '#ff2d20',
  labelText: '#ffffff',
};

export type ImageCropRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export function centeredImageCropRect(width: number, height: number, scale = 0.72): ImageCropRect {
  const safeScale = clamp(scale, 0.1, 1);
  const cropWidth = Math.max(1, Math.round(width * safeScale));
  const cropHeight = Math.max(1, Math.round(height * safeScale));
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

export async function centeredImageCropDataUrl(source: string, scale = 0.72): Promise<string> {
  const image = await loadImageElement(source);
  const width = Math.max(1, image.naturalWidth || image.width);
  const height = Math.max(1, image.naturalHeight || image.height);
  const crop = centeredImageCropRect(width, height, scale);
  const output = document.createElement('canvas');
  output.width = crop.width;
  output.height = crop.height;
  const context = output.getContext('2d');
  if (!context) throw new Error(translate('surface.image-annotation.imageAnnotationCanvasIsUnavailable'));
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return output.toDataURL('image/png');
}

export function imageDataUrlArrayBuffer(dataUrl: string): ArrayBuffer {
  const separator = dataUrl.indexOf(',');
  const header = separator >= 0 ? dataUrl.slice(0, separator) : '';
  if (!header.startsWith('data:image/png;') || !header.endsWith(';base64')) {
    throw new TypeError('Annotated image must be a base64 PNG data URL.');
  }
  const binary = atob(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(translate('surface.image-annotation.timedOutLoadingTheImageAnnotationFixture')));
    }, 1_200);
    image.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(translate('surface.image-annotation.unableToLoadTheImageAnnotationFixture')));
    };
    image.src = source;
  });
  return image;
}

export function measurementAnnotation(
  imageData: ImageData | null,
  point: ImageAnnotationPoint,
  tool: 'measure-horizontal' | 'measure-vertical',
  width: number,
  height: number,
): Pick<ImageAnnotation, 'start' | 'end' | 'tool'> {
  const axis = tool === 'measure-horizontal' ? 'horizontal' : 'vertical';
  const maxX = Math.max(0, width - 1);
  const maxY = Math.max(0, height - 1);
  const cursor = {
    x: clamp(Math.round(point.x), 0, maxX),
    y: clamp(Math.round(point.y), 0, maxY),
  };

  if (!imageData || imageData.width !== width || imageData.height !== height) {
    return axis === 'horizontal'
      ? { tool, start: { x: 0, y: cursor.y }, end: { x: maxX, y: cursor.y } }
      : { tool, start: { x: cursor.x, y: 0 }, end: { x: cursor.x, y: maxY } };
  }

  const negative = findEdge(imageData, cursor, axis, -1);
  const positive = findEdge(imageData, cursor, axis, 1);
  return axis === 'horizontal'
    ? { tool, start: { x: negative, y: cursor.y }, end: { x: positive, y: cursor.y } }
    : { tool, start: { x: cursor.x, y: negative }, end: { x: cursor.x, y: positive } };
}

export function annotationPixelLength(annotation: ImageAnnotation, pixelRatio = 1): number | null {
  const safePixelRatio = pixelRatio > 0 ? pixelRatio : 1;
  if (annotation.tool === 'measure-horizontal') {
    return interiorPixelGap(annotation.start.x, annotation.end.x) / safePixelRatio;
  }
  if (annotation.tool === 'measure-vertical') {
    return interiorPixelGap(annotation.start.y, annotation.end.y) / safePixelRatio;
  }
  return null;
}

function interiorPixelGap(start: number, end: number): number {
  return Math.max(0, Math.round(Math.abs(end - start)) - 1);
}

export function isDrawableAnnotation(annotation: ImageAnnotation): boolean {
  const width = Math.abs(annotation.end.x - annotation.start.x);
  const height = Math.abs(annotation.end.y - annotation.start.y);
  if (annotation.tool === 'measure-horizontal' || annotation.tool === 'measure-vertical') {
    return Math.max(width, height) >= 2;
  }
  if (annotation.tool === 'arrow') {
    return Math.hypot(width, height) >= 6;
  }
  return width >= 6 && height >= 6;
}

export function annotationAnchor(annotation: ImageAnnotation): ImageAnnotationPoint {
  if (annotation.tool === 'rectangle' || annotation.tool === 'oval') {
    return {
      x: Math.max(annotation.start.x, annotation.end.x),
      y: Math.min(annotation.start.y, annotation.end.y),
    };
  }
  if (annotation.tool === 'measure-horizontal' || annotation.tool === 'measure-vertical') {
    return annotation.end;
  }
  if (annotation.tool === 'arrow') return annotation.end;
  return annotation.end;
}

export function annotationCounterPlacement(annotation: ImageAnnotation): ImageAnnotationCounterPlacement {
  if (annotation.tool === 'measure-horizontal' || annotation.tool === 'measure-vertical') {
    const middle = midpoint(annotation.start, annotation.end);
    const counterOffset = 23;
    if (annotation.tool === 'measure-horizontal') {
      const anchor = middle;
      return { anchor, center: { x: anchor.x, y: anchor.y + counterOffset } };
    }
    const anchor = middle;
    return { anchor, center: { x: anchor.x - counterOffset, y: anchor.y } };
  }

  if (annotation.tool === 'arrow') {
    const anchor = annotation.end;
    const deltaX = annotation.end.x - annotation.start.x;
    const deltaY = annotation.end.y - annotation.start.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length > 0) {
      return {
        anchor,
        center: {
          x: anchor.x + (deltaX / length) * 23,
          y: anchor.y + (deltaY / length) * 23,
        },
      };
    }
  }

  const anchor = annotationAnchor(annotation);
  return {
    anchor,
    center: { x: anchor.x + 16, y: anchor.y - 16 },
  };
}

function midpoint(start: ImageAnnotationPoint, end: ImageAnnotationPoint): ImageAnnotationPoint {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

export function drawImageAnnotations(
  context: CanvasRenderingContext2D,
  annotations: readonly ImageAnnotation[],
  options: {
    clear?: boolean;
    height: number;
    palette?: ImageAnnotationPalette;
    pixelRatio?: number;
    width: number;
  },
): void {
  if (options.clear !== false) context.clearRect(0, 0, options.width, options.height);
  const palette = options.palette ?? defaultImageAnnotationPalette;
  const pixelRatio = options.pixelRatio && options.pixelRatio > 0 ? options.pixelRatio : 1;
  for (const annotation of annotations) drawAnnotation(context, annotation, palette, pixelRatio);
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: ImageAnnotation,
  palette: ImageAnnotationPalette,
  pixelRatio: number,
): void {
  let counterPlacement: ImageAnnotationCounterPlacement | null = null;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = palette.stroke;
  context.fillStyle = palette.stroke;
  context.lineWidth = 4;

  if (annotation.tool === 'arrow') drawArrow(context, annotation.end, annotation.start);
  else if (annotation.tool === 'rectangle') drawRoughRectangle(context, annotation.start, annotation.end);
  else if (annotation.tool === 'oval') drawRoughOval(context, annotation.start, annotation.end);
  else counterPlacement = drawMeasurement(context, annotation, palette, pixelRatio);

  if (annotation.number > 0) {
    drawCounter(
      context,
      counterPlacement ?? annotationCounterPlacement(annotation),
      annotation.number,
      palette,
    );
  }
  context.restore();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: ImageAnnotationPoint,
  end: ImageAnnotationPoint,
): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const bend = Math.min(8, distance * 0.06);
  const control = {
    x: (start.x + end.x) / 2 + Math.sin(angle) * bend,
    y: (start.y + end.y) / 2 - Math.cos(angle) * bend,
  };
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.quadraticCurveTo(control.x, control.y, end.x, end.y);
  context.stroke();

  const head = Math.min(22, Math.max(12, distance * 0.18));
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - Math.cos(angle - Math.PI / 6) * head, end.y - Math.sin(angle - Math.PI / 6) * head);
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - Math.cos(angle + Math.PI / 6) * head, end.y - Math.sin(angle + Math.PI / 6) * head);
  context.stroke();
}

function drawRoughRectangle(
  context: CanvasRenderingContext2D,
  start: ImageAnnotationPoint,
  end: ImageAnnotationPoint,
): void {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  context.beginPath();
  context.moveTo(left + 2, top);
  context.lineTo(right - 1, top + 1);
  context.quadraticCurveTo(right + 2, top + 2, right, top + 5);
  context.lineTo(right - 1, bottom - 2);
  context.quadraticCurveTo(right - 2, bottom + 2, right - 6, bottom);
  context.lineTo(left + 1, bottom - 1);
  context.quadraticCurveTo(left - 2, bottom - 2, left, bottom - 6);
  context.lineTo(left + 1, top + 2);
  context.stroke();
}

function drawRoughOval(
  context: CanvasRenderingContext2D,
  start: ImageAnnotationPoint,
  end: ImageAnnotationPoint,
): void {
  const centerX = (start.x + end.x) / 2;
  const centerY = (start.y + end.y) / 2;
  const radiusX = Math.max(1, Math.abs(end.x - start.x) / 2);
  const radiusY = Math.max(1, Math.abs(end.y - start.y) / 2);
  context.beginPath();
  context.ellipse(
    centerX,
    centerY,
    radiusX,
    radiusY,
    0,
    0,
    Math.PI * 2,
  );
  context.stroke();
}

function drawMeasurement(
  context: CanvasRenderingContext2D,
  annotation: ImageAnnotation,
  palette: ImageAnnotationPalette,
  pixelRatio: number,
): ImageAnnotationCounterPlacement {
  const horizontal = annotation.tool === 'measure-horizontal';
  const middle = midpoint(annotation.start, annotation.end);
  const label = `${annotationPixelLength(annotation, pixelRatio) ?? 0}px`;
  context.save();
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(annotation.start.x, annotation.start.y);
  context.lineTo(annotation.end.x, annotation.end.y);
  context.moveTo(
    annotation.start.x + (horizontal ? 0 : -5),
    annotation.start.y + (horizontal ? -5 : 0),
  );
  context.lineTo(
    annotation.start.x + (horizontal ? 0 : 5),
    annotation.start.y + (horizontal ? 5 : 0),
  );
  context.moveTo(
    annotation.end.x + (horizontal ? 0 : -5),
    annotation.end.y + (horizontal ? -5 : 0),
  );
  context.lineTo(
    annotation.end.x + (horizontal ? 0 : 5),
    annotation.end.y + (horizontal ? 5 : 0),
  );
  context.stroke();

  context.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
  const textWidth = context.measureText(label).width;
  const labelWidth = textWidth + 12;
  const labelHeight = 22;
  const labelGap = 6;
  const labelCenter = horizontal
    ? { x: middle.x, y: middle.y - labelHeight / 2 - labelGap }
    : { x: middle.x + labelWidth / 2 + labelGap, y: middle.y };
  const labelX = labelCenter.x - labelWidth / 2;
  const labelY = labelCenter.y - labelHeight / 2;
  roundedRect(context, labelX, labelY, labelWidth, labelHeight, 4);
  context.fillStyle = palette.labelFill;
  context.fill();
  context.fillStyle = palette.labelText;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, labelCenter.x, labelCenter.y + 0.5);
  context.restore();
  return annotationCounterPlacement(annotation);
}

function drawCounter(
  context: CanvasRenderingContext2D,
  placement: ImageAnnotationCounterPlacement,
  number: number,
  palette: ImageAnnotationPalette,
): void {
  const radius = 15;
  const { anchor, center } = placement;
  const deltaX = anchor.x - center.x;
  const deltaY = anchor.y - center.y;
  const distance = Math.hypot(deltaX, deltaY) || 1;
  const directionX = deltaX / distance;
  const directionY = deltaY / distance;
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const tailBase = {
    x: center.x + directionX * (radius - 3),
    y: center.y + directionY * (radius - 3),
  };
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = palette.labelFill;
  context.fill();
  context.beginPath();
  context.moveTo(tailBase.x + perpendicularX * 5, tailBase.y + perpendicularY * 5);
  context.lineTo(anchor.x, anchor.y);
  context.lineTo(tailBase.x - perpendicularX * 5, tailBase.y - perpendicularY * 5);
  context.closePath();
  context.fill();
  context.fillStyle = palette.labelText;
  context.font = '600 15px -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(number), center.x, center.y + 0.5);
  context.restore();
}

function findEdge(
  imageData: ImageData,
  point: ImageAnnotationPoint,
  axis: 'horizontal' | 'vertical',
  direction: -1 | 1,
): number {
  const limit = axis === 'horizontal' ? imageData.width : imageData.height;
  const start = axis === 'horizontal' ? point.x : point.y;
  for (let value = start + direction; value >= 0 && value < limit; value += direction) {
    if (isCoherentEdge(imageData, point, axis, value)) return value;
  }
  return direction < 0 ? 0 : limit - 1;
}

function isCoherentEdge(
  imageData: ImageData,
  origin: ImageAnnotationPoint,
  axis: 'horizontal' | 'vertical',
  value: number,
): boolean {
  const bandRadius = 3;
  const minimumDistance = 18;
  const minimumLocalDistance = 8;
  let matchingSamples = 0;
  let localMatchingSamples = 0;
  let totalDistance = 0;
  let totalLocalDistance = 0;
  for (let offset = -bandRadius; offset <= bandRadius; offset += 1) {
    const originPixel = axis === 'horizontal'
      ? pixelAt(imageData, origin.x, origin.y + offset)
      : pixelAt(imageData, origin.x + offset, origin.y);
    const candidatePixel = axis === 'horizontal'
      ? pixelAt(imageData, value, origin.y + offset)
      : pixelAt(imageData, origin.x + offset, value);
    const previousPixel = axis === 'horizontal'
      ? pixelAt(imageData, value + (value < origin.x ? 1 : -1), origin.y + offset)
      : pixelAt(imageData, origin.x + offset, value + (value < origin.y ? 1 : -1));
    const distance = colorDistance(originPixel, candidatePixel);
    const localDistance = colorDistance(previousPixel, candidatePixel);
    totalDistance += distance;
    totalLocalDistance += localDistance;
    if (distance >= minimumDistance) matchingSamples += 1;
    if (localDistance >= minimumLocalDistance) localMatchingSamples += 1;
  }
  const sampleCount = bandRadius * 2 + 1;
  return matchingSamples >= 3
    && localMatchingSamples >= 3
    && totalDistance / sampleCount >= minimumDistance
    && totalLocalDistance / sampleCount >= minimumLocalDistance;
}

function pixelAt(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const index = (clamp(y, 0, imageData.height - 1) * imageData.width + clamp(x, 0, imageData.width - 1)) * 4;
  return [
    imageData.data[index] ?? 0,
    imageData.data[index + 1] ?? 0,
    imageData.data[index + 2] ?? 0,
    imageData.data[index + 3] ?? 0,
  ];
}

function colorDistance(left: [number, number, number, number], right: [number, number, number, number]): number {
  return Math.sqrt(
    (left[0] - right[0]) ** 2
    + (left[1] - right[1]) ** 2
    + (left[2] - right[2]) ** 2
    + (left[3] - right[3]) ** 2,
  );
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
