import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppSnapshot } from '@workspace/core/contracts';
import { isWindowViewState, type WindowViewState } from '@workspace/core/windows';

export type WindowFrame = {
  bounds: { x: number; y: number; width: number; height: number };
  isMaximized: boolean;
};

export type SavedWindow = {
  /** What the window shows. Null is a plain workspace window. */
  viewState: WindowViewState | null;
  frame: WindowFrame;
};

/** The open windows, least recently focused first, so restoring them in order ends on the one that was in front. */
export type WindowLayout = {
  version: 1;
  windows: SavedWindow[];
};

const maxSavedWindows = 12;
const minSavedSize = 320;

export function parseWindowLayout(value: string): WindowLayout | null {
  try {
    const parsed = JSON.parse(value) as { version?: unknown; windows?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.windows)) return null;
    const windows = parsed.windows.slice(0, maxSavedWindows).flatMap((entry): SavedWindow[] => {
      const saved = savedWindow(entry);
      return saved ? [saved] : [];
    });
    return windows.length ? { version: 1, windows } : null;
  } catch {
    return null;
  }
}

function savedWindow(entry: unknown): SavedWindow | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { viewState, frame } = entry as { viewState?: unknown; frame?: { bounds?: Record<string, unknown>; isMaximized?: unknown } };
  if (viewState !== null && !isWindowViewState(viewState)) return null;
  const bounds = frame?.bounds;
  if (!bounds || !['x', 'y', 'width', 'height'].every(key => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))) return null;
  if ((bounds.width as number) < minSavedSize || (bounds.height as number) < minSavedSize) return null;
  return {
    viewState: viewState as WindowViewState | null,
    frame: { bounds: bounds as WindowFrame['bounds'], isMaximized: frame?.isMaximized === true },
  };
}

/**
 * The saved windows that can open again: a window about a team, an agent or a feature that is gone is dropped,
 * and a feature keeps the agents that remain. Windows that show the workspace forget a selection that is gone.
 */
export function restorableWindows(layout: WindowLayout, snapshot: AppSnapshot): SavedWindow[] {
  const hasAgent = (id: string | undefined): id is string => id !== undefined && snapshot.agents.some(agent => agent.id === id);
  return layout.windows.flatMap((saved): SavedWindow[] => {
    const state = saved.viewState;
    const scope = state?.scope ?? 'workspace';
    if (scope === 'agent') return hasAgent(state?.agentId) ? [saved] : [];
    if (scope === 'team') return snapshot.teams.some(team => team.id === state?.teamId) ? [saved] : [];
    if (scope === 'feature') {
      const agentIds = (state?.agentIds ?? []).filter(hasAgent);
      if (!agentIds.length) return [];
      return [{ ...saved, viewState: { ...state, agentIds, ...(hasAgent(state?.agentId) ? {} : { agentId: agentIds[0]! }) } }];
    }
    if (state?.agentId && !hasAgent(state.agentId)) return [{ ...saved, viewState: null }];
    return [saved];
  });
}

export function readWindowLayout(filePath: string): WindowLayout | null {
  try {
    return parseWindowLayout(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeWindowLayout(filePath: string, layout: WindowLayout): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(layout)}\n`, { mode: 0o600 });
}
