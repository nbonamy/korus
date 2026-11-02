import { classifyFile, type FileKind } from '@workspace/core/file-kind';

export type FileStat = { fullPath: string; addedLines: number; removedLines: number };
export type MapFile = FileStat & { name: string; kind: FileKind; weight: number };

export function diffTreemapFiles(files: readonly FileStat[]): MapFile[] {
  const byPath = new Map<string, MapFile>();
  for (const file of files) {
    const existing = byPath.get(file.fullPath);
    if (existing) {
      existing.addedLines += file.addedLines;
      existing.removedLines += file.removedLines;
      existing.weight += file.addedLines + file.removedLines;
    } else byPath.set(file.fullPath, { ...file, name: file.fullPath.split('/').at(-1)!, kind: classifyFile(file.fullPath), weight: file.addedLines + file.removedLines });
  }
  return [...byPath.values()].sort((a, b) => b.weight - a.weight || a.fullPath.localeCompare(b.fullPath));
}
