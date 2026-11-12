import { describe, expect, it } from 'vitest';

import {
  cloneVisualizeSession,
  isVisualizeSession,
  type Visualization,
  type VisualizeSession,
} from '../visualize';

function session(overrides: Partial<VisualizeSession> = {}): VisualizeSession {
  return {
    id: 'visualize-1',
    conversationRef: { provider: 'codex', conversationId: 'thread-1' },
    isOpen: true,
    suggestions: [{
      id: 'suggestion-1',
      title: 'System map',
      description: 'Show the request path',
      visualizationId: 'visualization-1',
    }],
    visualizations: [{
      id: 'visualization-1',
      title: 'Request path',
      content: { kind: 'mermaid', source: 'flowchart LR; A --> B' },
      createdAt: '2026-09-22T12:00:00.000Z',
      updatedAt: '2026-09-22T12:00:00.000Z',
    }],
    selectedVisualizationId: 'visualization-1',
    createdAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-22T12:00:00.000Z',
    ...overrides,
  };
}

describe('Visualize session contract', () => {
  it.each([
    { kind: 'mermaid', source: 'flowchart LR; A --> B' },
    { kind: 'svg', source: '<svg viewBox="0 0 10 10" />' },
    { kind: 'excalidraw', source: '{"elements":[],"files":{}}' },
    { kind: 'image', assetPath: '/tmp/map.png', mimeType: 'image/png', alt: 'System map' },
  ] satisfies Visualization['content'][])('accepts $kind visualization content', content => {
    expect(isVisualizeSession(session({
      visualizations: [{
        ...session().visualizations[0],
        content,
      }],
    }))).toBe(true);
  });

  it('accepts closed sessions without a conversation or selection', () => {
    expect(isVisualizeSession(session({
      conversationRef: null,
      isOpen: false,
      selectedVisualizationId: null,
    }))).toBe(true);
  });

  it.each(['claude', 'antigravity', 'cursor'] as const)('accepts %s conversation references', provider => {
    for (const folder of ['/workspace', null]) expect(isVisualizeSession(session({
      conversationRef: { provider: provider, folder, conversationId: 'session-1' },
    }))).toBe(true);
  });

  it.each([
    null,
    [],
    { ...session(), id: 1 },
    { ...session(), conversationRef: { provider: 'codex' } },
    { ...session(), isOpen: 'yes' },
    { ...session(), suggestions: 'invalid' },
    { ...session(), suggestions: Array.from({ length: 5 }, () => session().suggestions[0]) },
    { ...session(), suggestions: [{ id: 'bad', title: 1, description: 'description' }] },
    { ...session(), visualizations: 'invalid' },
    { ...session(), visualizations: Array.from({ length: 51 }, () => session().visualizations[0]) },
    { ...session(), visualizations: [{ ...session().visualizations[0], content: { kind: 'image', assetPath: '/tmp/map.bmp', mimeType: 'image/bmp', alt: 'Map' } }] },
    { ...session(), selectedVisualizationId: 'missing' },
    { ...session(), createdAt: 1 },
  ])('rejects malformed session %#', value => {
    expect(isVisualizeSession(value)).toBe(false);
  });

  it('deep-clones the session and drops obsolete visualization fields', () => {
    const original = session({
      visualizations: [{
        ...session().visualizations[0],
        revision: 7,
      } as Visualization & { revision: number }],
    });

    const cloned = cloneVisualizeSession(original);

    expect(cloned).toEqual(session());
    expect(cloned).not.toBe(original);
    expect(cloned.conversationRef).not.toBe(original.conversationRef);
    expect(cloned.suggestions[0]).not.toBe(original.suggestions[0]);
    expect(cloned.visualizations[0]).not.toBe(original.visualizations[0]);
    expect(cloned.visualizations[0].content).not.toBe(original.visualizations[0].content);
  });
});
