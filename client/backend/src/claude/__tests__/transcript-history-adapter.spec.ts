import { product } from '@workspace/core/product';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { claudeTranscriptGoal, claudeTranscriptSettings, claudeTranscriptToRendererMessages, listClaudeTranscriptSummaries, loadClaudeTranscriptHistory } from '../transcript-history-adapter';
import type { Agent } from '@workspace/core/contracts';



describe('claudeTranscriptToRendererMessages', () => {


  it('translates Claude JSONL transcript records into renderer messages', () => {
    const content = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'ignored' }),
      JSON.stringify({
        type: 'user',
        uuid: 'user-1',
        promptId: 'prompt-1',
        timestamp: '2026-06-06T22:33:42.809Z',
        message: { role: 'user', content: 'read README.md' },
      }),
      JSON.stringify({
        type: 'attachment',
        attachment: { type: 'skill_listing', content: 'ignored' },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        timestamp: '2026-06-06T22:33:43.100Z',
        cwd: '/workspace/project',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will read it.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'tool-result-1',
        timestamp: '2026-06-06T22:33:43.200Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: `# ${product.name}` }],
        },
      }),
      JSON.stringify({ type: 'last-prompt', lastPrompt: 'ignored' }),
    ].join('\n');

    expect(claudeTranscriptToRendererMessages(content, 'agent-claude', 'session-1')).toStrictEqual([
      {
        id: 'user-session-1-user-1',
        agentId: 'agent-claude',
        role: 'user',
        status: 'complete',
        turnId: 'claude-prompt-1',
        createdAt: '2026-06-06T22:33:42.809Z',
        parts: [{ type: 'text', text: 'read README.md' }],
      },
      {
        id: 'assistant-claude-prompt-1',
        agentId: 'agent-claude',
        role: 'assistant',
        status: 'complete',
        turnId: 'claude-prompt-1',
        createdAt: '2026-06-06T22:33:43.100Z',
        parts: [
          { type: 'text', text: 'I will read it.' },
          {
            type: 'tool',
            id: 'tool-1',
            kind: 'command',
            title: 'Read',
            status: 'completed',
            statusText: JSON.stringify({
              source: 'claude',
              action: 'read',
              phase: 'completed',
              params: { target: 'README.md' },
            }),
            input: {
              file_path: 'README.md',
              path: '/workspace/project/README.md',
              cwd: '/workspace/project',
            },
            output: `# ${product.name}`,
            body: `# ${product.name}`,
            metadata: {
              provider: 'claude',
              itemType: 'tool_use',
              claudeToolName: 'Read',
              cwd: '/workspace/project',
            },
          },
        ],
      },
    ]);
  });




});
