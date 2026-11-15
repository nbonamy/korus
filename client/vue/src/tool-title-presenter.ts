import { appToolTitle } from '@workspace/core/app-tool-title';
import { isAppMcpServerName } from '@workspace/core/product';
import {
  type ToolTitlePresenterContext,
} from '@korus-dev/agent-ui-sdk';

type ToolPhase = 'completed' | 'failed' | 'running';
type AgentNameResolver = (identifier: string) => string | undefined;

export function presentAppToolTitle({
  descriptor,
  toolCall,
}: ToolTitlePresenterContext, resolveAgentName?: AgentNameResolver): string | undefined {
  const tool = appToolName(toolCall.function, toolCall.kind, toolCall.metadata, descriptor?.params?.tool);
  if (!tool) return undefined;

  // Korus formats its own tools; the renderer only hands over what the call carried.
  return appToolTitle({
    tool,
    args: isRecord(toolCall.args) ? toolCall.args : {},
    result: toolCall.result,
    phase: toolPhase(descriptor?.phase, toolCall.state),
    resolveAgentName,
  });
}

export function appToolName(
  functionName: string,
  kind?: string,
  metadata?: Readonly<Record<string, unknown>>,
  descriptorTool?: unknown,
): string | undefined {
  const metadataTool = appMcpToolName(kind, metadata);
  if (metadataTool) return metadataTool;

  const rawName = typeof descriptorTool === 'string' ? descriptorTool : functionName;
  const match = /^mcp__(.+?)__(.+)$/.exec(rawName) ?? /^([^._]+)[._](.+)$/.exec(rawName);
  const toolName = match && isAppMcpServerName(match[1]) ? match[2] : undefined;
  if (!toolName) return undefined;

  return toolName.replaceAll('_', '-');
}

export function appMcpToolName(
  kind?: string,
  metadata?: Readonly<Record<string, unknown>>,
): string | undefined {
  if (kind !== 'mcp' || !isAppMcpServerName(metadata?.server) || typeof metadata?.tool !== 'string') {
    return undefined;
  }
  const tool = metadata.tool.trim().replaceAll('_', '-');
  return tool || undefined;
}

function toolPhase(descriptorPhase: string | undefined, state: string): ToolPhase {
  if (descriptorPhase === 'failed' || state === 'error') return 'failed';
  if (descriptorPhase === 'completed' || state === 'completed') return 'completed';
  return 'running';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
