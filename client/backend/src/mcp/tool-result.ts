import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const STRUCTURED_TOOL_RESULT_NOTICE = 'Result returned in structuredContent.';

export function structuredToolResult(data: unknown, options: { text?: string } = {}): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: options.text ?? STRUCTURED_TOOL_RESULT_NOTICE,
      },
    ],
    structuredContent: toStructuredContent(data),
    isError: false,
  };
}

export function errorToolResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

function toStructuredContent(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  return {
    result: data ?? null,
  };
}
