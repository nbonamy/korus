import type { CanvasElement } from './visualize-canvas';

export const diffVizStatuses = ['added', 'changed', 'deleted', 'unchanged'] as const;
export type DiffVizStatus = typeof diffVizStatuses[number];
export const diffVisualizationModes = ['fast', 'polished'] as const;
export type DiffVisualizationMode = typeof diffVisualizationModes[number];
export const diffVizIcons = ['repository', 'interface', 'agent', 'service', 'database', 'sync', 'api', 'code', 'settings', 'tests', 'queue', 'document', 'security', 'diagram'] as const;
export type DiffVizIcon = typeof diffVizIcons[number];
export const maxDiffVizComponents = 12;
export type DiffVizLocation = { path: string; line: number; endLine?: number; side?: 'old' | 'new' };
export type DiffVizReview = { title: string; changed: string; impact: string; question: string };
export type DiffVizNode = { id: string; label: string; status: DiffVizStatus; paths: string[]; icon?: DiffVizIcon; review?: DiffVizReview; locations?: DiffVizLocation[] };
export type DiffVizDiagram = { nodes: DiffVizNode[]; title?: string; layout?: string } & (
  | { format: 'excalidraw'; elements: CanvasElement[]; groups: string[] }
  | { format: 'mermaid'; source: string }
);
export type NativeDiffVizDiagram = Extract<DiffVizDiagram, { format: 'excalidraw' }>;
