import { describe, expect, it } from 'vitest';
import {
  errorToolResult,
  structuredToolResult,
  STRUCTURED_TOOL_RESULT_NOTICE,
} from '../tool-result';

describe('MCP tool results', () => {
  it('keeps model-facing text short and stores object data in structuredContent', () => {
    const result = structuredToolResult({
      agents: [
        {
          id: 'agent-dina',
          status: 'Idle',
        },
      ],
    });

    expect(result).toStrictEqual({
      content: [
        {
          type: 'text',
          text: STRUCTURED_TOOL_RESULT_NOTICE,
        },
      ],
      structuredContent: {
        agents: [
          {
            id: 'agent-dina',
            status: 'Idle',
          },
        ],
      },
      isError: false,
    });
  });

  it('wraps primitive data so structuredContent is always an object', () => {
    expect(structuredToolResult('Status updated').structuredContent).toStrictEqual({
      result: 'Status updated',
    });
  });

  it('returns model-readable text for errors without structuredContent', () => {
    expect(errorToolResult('Sender not registered')).toStrictEqual({
      content: [
        {
          type: 'text',
          text: 'Sender not registered',
        },
      ],
      isError: true,
    });
  });
});
