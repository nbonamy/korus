import type { UtilityMcpServer } from '@workspace/core/provider-driver';

/** Utility callers may supply only the private loopback icon capability. */
export function utilityMcpServers(value: unknown): UtilityMcpServer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1) throw new Error('Invalid utility MCP servers.');
  return value.map((server) => {
    if (
      !server ||
      typeof server !== 'object' ||
      typeof server.name !== 'string' ||
      !/^diagram_icons_[a-zA-Z0-9_]+$/.test(server.name) ||
      typeof server.url !== 'string' ||
      !Array.isArray(server.enabledTools) ||
      server.enabledTools.length !== 1 ||
      server.enabledTools[0] !== 'fetch_tech_icon'
    )
      throw new Error('Invalid utility MCP server.');
    const url = new URL(server.url);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/mcp\/[a-zA-Z0-9-]+$/.test(url.pathname)
    )
      throw new Error('Invalid utility MCP endpoint.');
    return { name: server.name, url: url.href, enabledTools: ['fetch_tech_icon'] };
  });
}
