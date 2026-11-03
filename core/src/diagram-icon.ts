/** Self-contained fetched bytes, embedded directly in a diagram when used. */
export type DiagramIconImage = {
  mimeType: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
  source: 'svgl' | 'devicon' | 'gilbarbara' | 'lucide' | 'explicit';
  sourceUrl: string;
  whiteFill: boolean;
};
export function isDiagramIconImage(value: unknown): value is DiagramIconImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  return (
    ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(String(image.mimeType)) &&
    typeof image.base64 === 'string' &&
    image.base64.length > 0 &&
    image.base64.length <= 3 * 1024 * 1024 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(image.base64) &&
    ['svgl', 'devicon', 'gilbarbara', 'lucide', 'explicit'].includes(String(image.source)) &&
    typeof image.sourceUrl === 'string' &&
    image.sourceUrl.startsWith('https://') &&
    typeof image.whiteFill === 'boolean'
  );
}
