import type { DiffVizNode } from '@workspace/core/git-diff-viz';

export function diffVizTooltip(node: DiffVizNode): string {
  const review = node.review;
  const links = node.paths.map(path => {
    const locations = node.locations?.filter(location => location.path === path);
    return locations?.length ? locations.map(location => `${path}:${location.line}${location.endLine && location.endLine !== location.line ? `–${location.endLine}` : ''}`).join('\n') : path;
  });
  return [review?.title ?? node.label, review?.changed, review?.impact, review?.question, ...links].filter(Boolean).join('\n');
}
