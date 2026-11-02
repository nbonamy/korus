export type TreemapRect = { x: number; y: number; width: number; height: number };
export type TreemapLayout = {
  size: { width: number; height: number };
  tiles: { file: import('./diff-treemap-files').MapFile; rect: TreemapRect }[];
};
