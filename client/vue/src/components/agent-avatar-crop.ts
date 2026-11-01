
import { translate } from '../i18n';export type AvatarCropPan = {
  x: number;
  y: number;
};

export async function cropImageDataUrl(source: string, scale = 1, pan: AvatarCropPan = { x: 0, y: 0 }, stageSize = 200): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return source;
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropSize = Math.min(sourceWidth, sourceHeight) / Math.max(scale, 1);
  const panScale = cropSize / Math.max(stageSize, 1);
  const sourceX = clamp((sourceWidth - cropSize) / 2 - pan.x * panScale, 0, sourceWidth - cropSize);
  const sourceY = clamp((sourceHeight - cropSize) / 2 - pan.y * panScale, 0, sourceHeight - cropSize);
  context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}

export function avatarCropPanLimits(
  imageSize: { height: number; width: number },
  scale = 1,
  stageSize = 200,
): AvatarCropPan {
  const sourceWidth = imageSize.width;
  const sourceHeight = imageSize.height;
  const cropSize = Math.min(sourceWidth, sourceHeight) / Math.max(scale, 1);
  const panScale = cropSize / Math.max(stageSize, 1);

  return {
    x: ((sourceWidth - cropSize) / 2) / panScale,
    y: ((sourceHeight - cropSize) / 2) / panScale,
  };
}

export function clampAvatarCropPan(
  pan: AvatarCropPan,
  imageSize: { height: number; width: number } | null,
  scale = 1,
  stageSize = 200,
): AvatarCropPan {
  if (!imageSize) {
    return { x: 0, y: 0 };
  }

  const limits = avatarCropPanLimits(imageSize, scale, stageSize);
  return {
    x: clamp(pan.x, -limits.x, limits.x),
    y: clamp(pan.y, -limits.y, limits.y),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(translate('surface.agent-avatar-crop.unableToLoadAvatarImage')));
    image.src = source;
  });
}
