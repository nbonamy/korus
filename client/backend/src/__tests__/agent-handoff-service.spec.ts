import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { AgentCreationService } from '../agents/agent-creation-service';
import { AgentHandoffService } from '../agents/agent-handoff-service';
import { createTestSnapshot } from './server-test-fixtures';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';


function fixture() {
  const snapshot = createTestSnapshot();
  const source: Agent = {
    id: 'source', name: 'Worker', backend: 'codex', teamId: 'team-test', folder: '/repo/worktree',
    backendSession: { kind: 'codex', threadId: 'original' }, status: { type: 'idle' },
    createdAt: '', updatedAt: '',
  };
  snapshot.agents.push(source);
  snapshot.teams[0]!.agentIds.push(source.id);
  snapshot.activeAgentId = source.id;
  const events: string[] = [];
  const persist = vi.fn(async () => { events.push('save'); });
  const note = vi.fn(async () => 'Goal: finish the fix. Tests pass. Next: review.');
  const retire = vi.fn(async () => { events.push('close'); });
  const start = vi.fn(async (agent: Agent, prompt: string) => {
    events.push('start');
    expect(snapshot.agents.some(item => item.id === source.id)).toBe(false);
    expect(agent.folder).toBe(source.folder);
    expect(prompt).toContain('Goal: finish the fix.');
  });
  const service = new AgentHandoffService({ snapshot, create: input => new AgentCreationService(snapshot).create(input), persist, requestNote: note, assertReady: async () => undefined, retire, start });
  const input = { operationId: 'one', selection: { backend: 'claude' as const, model: 'sonnet', reasoningEffort: 'high', serviceTier: 'fast' }, instructions: 'Mention the flaky test.' };
  return { snapshot, source, events, persist, note, retire, start, service, input };
}

describe('agent handoff', () => {
  it.each(['claude', 'antigravity'] as const)('hands off to %s once with a saved note and preserved workspace linkage', async backend => {
    const f = fixture();
    f.snapshot.providerConnections?.push({ backend: 'antigravity', installed: true, connected: true, checking: false });
    const input = { ...f.input, selection: { ...f.input.selection, backend } };
    await f.service.run(f.source.id, input);
    const target = f.snapshot.agents[0]!;
    expect(f.snapshot.agents).toHaveLength(1);
    expect(target).toMatchObject({ backend, folder: '/repo/worktree', backendDefaults: { kind: backend, model: 'sonnet' }, handoff: { sourceAgentId: 'source', sourceRef: { backend: 'codex', threadId: 'original' }, phase: 'complete' } });
    expect(f.note).toHaveBeenCalledWith(f.source, expect.stringContaining(backend === 'antigravity' ? 'Antigravity' : 'Claude Code'));
    expect(f.note).toHaveBeenCalledWith(f.source, expect.stringContaining('Mention the flaky test.'));
    expect(f.events.slice(f.events.indexOf('close') - 1, f.events.indexOf('close') + 3)).toEqual(['save', 'close', 'save', 'start']);
    await f.service.run(f.source.id, input);
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.retire).toHaveBeenCalledOnce();
    const restored = snapshotFromPersistedState(persistedStateFromSnapshot(f.snapshot));
    expect(restored.agents[0]!.handoff).toEqual(target.handoff);
  });

  it('keeps the source usable when note preparation fails and never starts a replacement', async () => {
    const f = fixture();
    f.note.mockRejectedValue(new Error('Note interrupted'));
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('Note interrupted');
    expect(f.snapshot.agents).toEqual([f.source]);
    expect(f.source.handoff).toMatchObject({ phase: 'failed', error: 'Note interrupted' });
    expect(f.retire).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it('does not close the source or send the target when persisting the prepared note fails', async () => {
    const f = fixture();
    f.persist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('Disk full');
    expect(f.snapshot.agents).toContain(f.source);
    expect(f.retire).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it('retains a saved note on the replacement after ambiguous start failure without replaying it', async () => {
    const f = fixture();
    f.start.mockRejectedValue(new Error('Connection lost'));
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('Connection lost');
    expect(f.snapshot.agents[0]!.handoff).toMatchObject({ phase: 'failed', note: expect.stringContaining('Goal:'), error: 'Connection lost' });
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('Connection lost');
    expect(f.start).toHaveBeenCalledOnce();
  });

  it('retains a message arriving during source retirement instead of removing its recipient', async () => {
    const f = fixture();
    f.retire.mockImplementation(async () => {
      f.snapshot.queuedPrompts = [{ id: 'late', agentId: f.source.id, text: 'New requirement', createdAt: '' }];
    });
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('queued prompts');
    expect(f.snapshot.agents).toEqual([f.source]);
    expect(f.snapshot.queuedPrompts).toHaveLength(1);
    expect(f.start).not.toHaveBeenCalled();
  });

  it('does not recreate an agent removed with its team while preparing the note', async () => {
    const f = fixture();
    f.note.mockImplementation(async () => { f.snapshot.agents = []; return 'Saved work.'; });
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('no longer available');
    expect(f.snapshot.agents).toEqual([]);
    expect(f.retire).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });

  it('rejects busy sources and recovers interrupted operations without provider calls', async () => {
    const f = fixture();
    f.source.status = { type: 'working' };
    await expect(f.service.run(f.source.id, f.input)).rejects.toThrow('finish');
    f.source.handoff = { ...f.input, sourceAgentId: 'source', sourceTitle: 'Worker', sourceRef: { backend: 'codex', threadId: 'original' }, phase: 'preparing' };
    await f.service.recover();
    expect(f.source.handoff.phase).toBe('failed');
    expect(f.note).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
  });
});
