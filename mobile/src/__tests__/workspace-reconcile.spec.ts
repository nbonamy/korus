import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import type { CompanionWorkspace } from '../companion-port';
import { reconcileWorkspace } from '../workspace-reconcile';

const agent = (id: string, statusText = 'idle'): Agent => ({ id, teamId: 'team', name: id, folder: null, provider: 'codex', status: { type: 'idle' }, statusText, createdAt: '', updatedAt: '' });
const workspace = (agents: Agent[], extra: Partial<CompanionWorkspace> = {}): CompanionWorkspace => ({ teams: [{ id: 'team', name: 'Team', agentIds: agents.map((a) => a.id) }], agents, repositoryIcons: { '/r': 'A' }, ...extra });
const copy = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

describe('keeping the workspace stable across repeated updates', () => {
  it('reads the conversation of agents from laptops on earlier builds', () => {
    const laptop = workspace([{ ...agent('a'), providerSession: { kind: 'codex', threadId: 't1' } as never }]);
    expect(reconcileWorkspace(workspace([]), laptop).agents[0]!.providerSession).toEqual({ kind: 'codex', conversationId: 't1' });
  });
  it('returns the very same workspace when the laptop repeats itself', () => {
    const previous = workspace([agent('a'), agent('b')]);
    expect(reconcileWorkspace(previous, copy(previous))).toBe(previous);
  });
  it('replaces only what changed and keeps every other object', () => {
    const previous = workspace([agent('a'), agent('b')]);
    const next = reconcileWorkspace(previous, workspace([agent('a'), agent('b', 'Reading files')]));
    expect(next).not.toBe(previous);
    expect(next.agents[0]).toBe(previous.agents[0]);
    expect(next.agents[1]).not.toBe(previous.agents[1]);
    expect(next.agents[1]!.statusText).toBe('Reading files');
    expect(next.teams).toBe(previous.teams);
    expect(next.repositoryIcons).toBe(previous.repositoryIcons);
  });
  it('follows agents that appear, disappear or move', () => {
    const previous = workspace([agent('a'), agent('b')]);
    const next = reconcileWorkspace(previous, workspace([agent('c'), agent('b')]));
    expect(next.agents.map((a) => a.id)).toEqual(['c', 'b']);
    expect(next.agents[1]).toBe(previous.agents[1]);
    expect(reconcileWorkspace(previous, workspace([agent('b'), agent('a')])).agents.map((a) => a.id)).toEqual(['b', 'a']);
  });
  it('keeps the optional parts the laptop sends only sometimes', () => {
    const previous = workspace([agent('a')], { providers: { team: ['codex'] }, modelFavorites: [] });
    const same = reconcileWorkspace(previous, copy(previous));
    expect(same).toBe(previous);
    expect(reconcileWorkspace(previous, { ...copy(previous), providers: { team: ['codex', 'claude'] } }).providers).toEqual({ team: ['codex', 'claude'] });
  });
});
