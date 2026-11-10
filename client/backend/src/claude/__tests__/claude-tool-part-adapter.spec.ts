import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeToolFileActivity,
  claudeToolPart,
  claudeToolPartInputUpdate,
  completedClaudeToolPart,
} from '../claude-tool-part-adapter';

describe('Claude tool part adapter', () => {














  it.each(['workspace', product.mcpServerName])('preserves %s tool identity without exposing private announcement text', (server) => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'mcp-1',
      name: `mcp__${server}__set_status`,
      input: {
        status: 'Testing',
        announcement: { phase: 'start', text: 'A phrase that must not enter renderer state.' },
      },
    });

    expect(part).toMatchObject({
      kind: 'mcp',
      title: `${server}.set_status`,
      input: { status: 'Testing' },
      metadata: {
        provider: 'claude',
        server,
        tool: 'set_status',
      },
    });
    expect(JSON.stringify(part)).not.toContain('phrase that must not');
  });

  it.each(['workspace', product.mcpServerName])('keeps %s finish-turn effects while removing the spoken phrase', (server) => {
    const part = claudeToolPart({
      type: 'tool_use',
      id: 'mcp-finish',
      name: `mcp__${server}__finish_turn`,
      input: {
        flag: 'ready_for_review',
        announcement: { text: 'A private completion phrase.' },
        celebration: true,
      },
    });

    expect(part).toMatchObject({
      input: {
        flag: 'ready_for_review',
        celebration: true,
      },
    });
    expect(JSON.stringify(part)).not.toContain('private completion phrase');
  });


});
