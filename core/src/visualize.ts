import { isCanvasDocument, type CanvasDocument } from './visualize-canvas';
import type { Agent, BackendConversationRef } from './contracts';

export const visualizationKinds = ['mermaid', 'svg', 'image'] as const;

export const visualizationSuggestionLimits = {
  title: 80,
  description: 120,
} as const;

export const visualizeDebugScenarios = ['complete', 'suggestions'] as const;
export type VisualizeDebugScenario = typeof visualizeDebugScenarios[number];

export type VisualizationKind = typeof visualizationKinds[number];

export type VisualizationSuggestion = {
  id: string;
  title: string;
  description: string;
  visualizationId?: string;
};

export type VisualizationTextContent = {
  kind: 'mermaid' | 'svg';
  source: string;
};

export type VisualizationImageContent = {
  kind: 'image';
  assetPath: string;
  mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';
  alt: string;
};

export type VisualizationContent = VisualizationTextContent | VisualizationImageContent;

export type Visualization = {
  id: string;
  title: string;
  content: VisualizationContent;
  canvas?: CanvasDocument;
  createdAt: string;
  updatedAt: string;
};

export type RepositoryVisualizations = Record<string, Visualization[]>;

export function visualizationRepositoryRoot(agent: Agent): string | null {
  const workspace = agent.workspace;
  return workspace?.kind === 'git' && workspace.folder === agent.folder
    ? workspace.primaryWorktreeRoot
    : null;
}

export type VisualizeSession = {
  id: string;
  conversationRef: BackendConversationRef | null;
  isOpen: boolean;
  suggestions: VisualizationSuggestion[];
  visualizations: Visualization[];
  selectedVisualizationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StartVisualizeInput = {
  prompt?: string;
  choose?: boolean;
};

export type GenerateVisualizationSuggestionInput = {
  suggestionId: string;
};

export type SelectVisualizationInput = {
  visualizationId: string;
};

export type DeleteVisualizationInput = {
  visualizationId: string;
};

export type SetVisualizeOpenInput = {
  open: boolean;
};

export type VisualizationAsset = {
  visualizationId: string;
  mimeType: VisualizationImageContent['mimeType'];
  dataUrl: string;
};

export function isVisualizeSession(value: unknown): value is VisualizeSession {
  if (!record(value)) return false;
  return typeof value.id === 'string'
    && (value.conversationRef === null || isConversationRef(value.conversationRef))
    && typeof value.isOpen === 'boolean'
    && Array.isArray(value.suggestions)
    && value.suggestions.length <= 4
    && value.suggestions.every(isVisualizationSuggestion)
    && Array.isArray(value.visualizations)
    && value.visualizations.length <= 50
    && value.visualizations.every(isVisualization)
    && (value.selectedVisualizationId === null || typeof value.selectedVisualizationId === 'string')
    && (value.selectedVisualizationId === null || value.visualizations.some(visualization => visualization.id === value.selectedVisualizationId))
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

export function cloneVisualizeSession(session: VisualizeSession): VisualizeSession {
  return {
    ...session,
    conversationRef: session.conversationRef ? { ...session.conversationRef } : null,
    suggestions: session.suggestions.map(suggestion => ({ ...suggestion })),
    visualizations: session.visualizations.map(visualization => ({
      id: visualization.id,
      title: visualization.title,
      content: { ...visualization.content },
      ...(visualization.canvas ? { canvas: structuredClone(visualization.canvas) } : {}),
      createdAt: visualization.createdAt,
      updatedAt: visualization.updatedAt,
    })),
  };
}

function isVisualizationSuggestion(value: unknown): value is VisualizationSuggestion {
  return record(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && (value.visualizationId === undefined || typeof value.visualizationId === 'string');
}

export function isVisualization(value: unknown): value is Visualization {
  return record(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && isVisualizationContent(value.content)
    && (value.canvas === undefined || isCanvasDocument(value.canvas))
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isVisualizationContent(value: unknown): value is VisualizationContent {
  if (!record(value)) return false;
  if (value.kind === 'mermaid' || value.kind === 'svg') {
    return typeof value.source === 'string';
  }
  return value.kind === 'image'
    && typeof value.assetPath === 'string'
    && ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType as string)
    && typeof value.alt === 'string';
}

function isConversationRef(value: unknown): value is BackendConversationRef {
  if (!record(value)) return false;
  return (value.backend === 'codex' && typeof value.threadId === 'string')
    || ((value.backend === 'claude' || value.backend === 'antigravity') && typeof value.folder === 'string' && typeof value.sessionId === 'string');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
