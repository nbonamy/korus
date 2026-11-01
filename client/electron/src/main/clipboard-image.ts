type ClipboardImageReader = {
  availableFormats(): string[];
  readBuffer(format: string): Buffer;
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pixelsPerMeterAtOneX = 72 / 0.0254;

export function readClipboardPngBuffer(clipboard: ClipboardImageReader): Buffer | undefined {
  const advertisedFormats = clipboard.availableFormats().filter(isPngClipboardFormat);
  const formats = [...new Set([
    ...advertisedFormats,
    'public.png',
    'Apple PNG pasteboard type',
    'image/png',
  ])];

  for (const format of formats) {
    try {
      const buffer = clipboard.readBuffer(format);
      if (buffer.length > 0) return buffer;
    } catch {
      // Electron can advertise image/png while exposing bytes only through a native macOS alias.
    }
  }

  return undefined;
}

export function detectPngRetinaPixelRatio(data: Uint8Array): 2 | undefined {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return undefined;
  }

  let offset = pngSignature.length;
  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + dataLength + 4;
    if (nextOffset > buffer.length) return undefined;

    const chunkType = buffer.toString('ascii', offset + 4, dataOffset);
    if (chunkType === 'pHYs' && dataLength === 9) {
      const xScale = buffer.readUInt32BE(dataOffset) / pixelsPerMeterAtOneX;
      const yScale = buffer.readUInt32BE(dataOffset + 4) / pixelsPerMeterAtOneX;
      const unitIsMeters = buffer[dataOffset + 8] === 1;
      return unitIsMeters && isApproximatelyTwoX(xScale) && isApproximatelyTwoX(yScale) ? 2 : undefined;
    }

    offset = nextOffset;
  }

  return undefined;
}

function isPngClipboardFormat(format: string): boolean {
  const normalized = format.toLowerCase();
  return normalized === 'image/png' || normalized === 'public.png' || normalized.includes('png pasteboard');
}

function isApproximatelyTwoX(scale: number): boolean {
  return scale >= 1.75 && scale <= 2.25;
}
