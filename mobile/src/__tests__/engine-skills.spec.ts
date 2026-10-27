import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { BackendSkillSummary } from '@workspace/core/contracts';

const skills: BackendSkillSummary[] = [
  { name: 'Commit-Push (cp)', path: '/skills/commit-push/SKILL.md', shortDescription: 'Commit and push changes', enabled: true },
  { name: 'hidden', path: '/skills/hidden/SKILL.md', enabled: false },
];

function fixture(listSkills = vi.fn(async (_id: string) => skills)) {
  const connector = createDemoConnector(); const connect = connector.connect;
  const sendPrompt = vi.fn(async () => {});
  connector.connect = async (id) => ({ ...await connect(id), listSkills, sendPrompt });
  const engine = createEngine({ connector, post() {} });
  const open = async () => { await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); };
  return { engine, open, listSkills, sendPrompt };
}

describe('mobile skill catalog', () => {
  it('loads skills on demand and preserves explicit selections separately from typed text', async () => {
    const f = fixture();
    try {
      await f.open();
      expect(f.listSkills).not.toHaveBeenCalled();
      await f.engine.dispatch({ type: 'loadSkills' });
      expect(f.engine.snapshot().skills).toStrictEqual({ status: 'loaded', items: [
        { id: skills[0]!.path, name: 'Commit-Push (cp)', insertText: 'cp', value: skills[0]!.name, description: 'Commit and push changes' },
      ] });
      await f.engine.dispatch({ type: 'send', text: 'Please $cp this change' });
      expect(f.sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Please $cp this change', expect.any(String), { planMode: false });
      const content = [{ type: 'text' as const, text: '$cp vs ' }, { type: 'mention' as const, kind: 'skill' as const, id: skills[0]!.path, value: skills[0]!.name, label: 'Commit-Push (cp)' }];
      await f.engine.dispatch({ type: 'send', text: '$cp vs $cp', options: { content } });
      expect(f.sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), '$cp vs Commit-Push (cp)', expect.any(String), { planMode: false, content });
    } finally { f.engine.dispose(); }
  });

  it('discards a late catalog after changing chats and lets a failed lookup be retried', async () => {
    let resolve!: (value: BackendSkillSummary[]) => void;
    const list = vi.fn(async (_id: string): Promise<BackendSkillSummary[]> => skills)
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockRejectedValueOnce(new Error('Offline'));
    const f = fixture(list);
    try {
      await f.open();
      const loading = f.engine.dispatch({ type: 'loadSkills' });
      expect(f.engine.snapshot().skills.status).toBe('loading');
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      resolve(skills); await loading;
      expect(f.engine.snapshot().skills).toStrictEqual({ status: 'idle', items: [] });
      await f.engine.dispatch({ type: 'loadSkills' });
      expect(f.engine.snapshot().skills).toStrictEqual({ status: 'failed', items: [] });
      await f.engine.dispatch({ type: 'loadSkills' });
      expect(f.engine.snapshot().skills.status).toBe('loaded');
      expect(list).toHaveBeenLastCalledWith('demo-reviewer');
      await f.engine.dispatch({ type: 'disconnect' });
      expect(f.engine.snapshot().skills).toStrictEqual({ status: 'idle', items: [] });
    } finally { f.engine.dispose(); }
  });

});
