import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { parseWindowLayout, readWindowLayout, restorableWindows, writeWindowLayout, type WindowLayout } from '../window-layout';

const frame = { bounds: { x: 10, y: 20, width: 1200, height: 800 }, isMaximized: false };
const snapshot = createInitialSnapshot();
const [agentA, agentB] = snapshot.agents.map(agent => agent.id) as [string, string];
const teamId = snapshot.teams[0]!.id;
// Two features of the team: agent A works on feat1, agent B on feat2.
snapshot.agents[0]!.teamId = teamId;
snapshot.agents[1]!.teamId = teamId;
snapshot.agents[0]!.workspace = { kind: 'git', branch: 'feat1' } as never;
snapshot.agents[1]!.workspace = { kind: 'git', branch: 'feat2' } as never;
const layout = (...windows: WindowLayout['windows']): WindowLayout => ({ version: 1, windows });

describe('window layout', () => {
  it('round-trips through a private file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'layout-'));
    try {
      const file = path.join(dir, 'nested', 'window-layout.json');
      const saved = layout(
        { viewState: { setup: { [agentA]: { open: true, width: 420, activeTab: 'browser', tabs: ['review', 'browser'], browserUrl: 'https://example.com/' } } }, frame },
        { viewState: { agentId: agentA, scope: 'agent' }, frame: { ...frame, isMaximized: true } },
        { viewState: { teamId, scope: 'team' }, frame },
        { viewState: { teamId, branch: 'feat1', agentId: agentA, scope: 'feature' }, frame },
      );
      writeWindowLayout(file, saved);
      expect(readWindowLayout(file)).toEqual(saved);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
      if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    ['not json', 'nope'],
    ['another version', JSON.stringify({ version: 2, windows: [{ viewState: null, frame }] })],
    ['no windows', JSON.stringify({ version: 1, windows: [] })],
    ['only unusable windows', JSON.stringify({ version: 1, windows: [{ viewState: { scope: 'agent' }, frame }, { viewState: null, frame: { bounds: { x: 0, y: 0, width: 10, height: 10 } } }] })],
  ])('rejects %s', (_name, value) => expect(parseWindowLayout(value)).toBeNull());

  it('keeps the usable windows of a damaged layout and caps how many it restores', () => {
    const windows = [{ viewState: null, frame }, { viewState: { scope: 'team' }, frame }, ...Array.from({ length: 20 }, () => ({ viewState: null, frame }))];
    expect(parseWindowLayout(JSON.stringify({ version: 1, windows }))!.windows).toHaveLength(11);
  });

  it('drops a window whose setup cannot be read rather than restoring it half-way', () => {
    const bad = { viewState: { setup: { a: { open: 'yes' } } }, frame };
    const good = { viewState: null, frame };
    expect(parseWindowLayout(JSON.stringify({ version: 1, windows: [bad, good] }))!.windows).toEqual([good]);
  });

  it('returns nothing for a missing file', () => {
    expect(readWindowLayout(path.join(os.tmpdir(), 'definitely-missing-layout.json'))).toBeNull();
  });
});

describe('restorable windows', () => {
  it('drops windows whose team, agent or feature is gone', () => {
    const restored = restorableWindows(layout(
      { viewState: { agentId: agentA, scope: 'agent' }, frame },
      { viewState: { agentId: 'agent-gone', scope: 'agent' }, frame },
      { viewState: { teamId: 'team-gone', scope: 'team' }, frame },
      { viewState: { teamId, scope: 'team' }, frame },
      { viewState: { teamId, branch: 'feat2', agentId: 'agent-gone', scope: 'feature' }, frame },
      { viewState: { teamId, branch: 'feat-gone', scope: 'feature' }, frame },
      { viewState: { teamId: 'team-gone', branch: 'feat1', scope: 'feature' }, frame },
    ), snapshot);
    expect(restored.map(window => window.viewState)).toEqual([
      { agentId: agentA, scope: 'agent' },
      { teamId, scope: 'team' },
      { teamId, branch: 'feat2', agentId: agentB, scope: 'feature' },
    ]);
  });

  it('forgets a selection that is gone for a workspace window but keeps the window', () => {
    const restored = restorableWindows(layout({ viewState: { agentId: 'agent-gone' }, frame }, { viewState: { agentId: agentA }, frame }), snapshot);
    expect(restored.map(window => window.viewState)).toEqual([null, { agentId: agentA }]);
  });
});
