import { configuredAppHome } from '../core/src/app-home.ts';
import product from '../core/src/product.json' with { type: 'json' };
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

export function providerTokensFilePath(env = process.env, home = homedir()) {
  const configuredHome = configuredAppHome(env);
  return path.join(configuredHome || path.join(home, `${product.homeDirectory}`), 'provider-tokens.json');
}

export function githubAccessTokenFromFile(contents) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('The provider token file is not valid JSON.');
  }

  const accessToken = value?.tokens?.github?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('No connected GitHub access token was found.');
  }
  return accessToken.trim();
}

export function githubMcpHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-MCP-Readonly': 'true',
    'X-MCP-Tools': 'get_me',
  };
}

export function githubLoginFromToolResult(result) {
  for (const item of result?.content ?? []) {
    if (item?.type !== 'text') continue;
    try {
      const value = JSON.parse(item.text);
      if (typeof value?.login === 'string' && value.login.trim()) return value.login.trim();
    } catch {
      // A successful tool response need not be JSON; identity is optional output.
    }
  }
  return null;
}

export function redactGitHubCredentials(message, secrets = []) {
  let redacted = String(message);
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted.replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{8,}\b/giu, '[redacted]');
}

export async function verifyGitHubMcpToken(options = {}) {
  const filePath = options.filePath ?? providerTokensFilePath();
  const contents = await (options.readTextFile ?? readFile)(filePath, 'utf8');
  const accessToken = githubAccessTokenFromFile(contents);
  const endpoint = new URL(options.endpoint ?? DEFAULT_GITHUB_MCP_URL);
  const connection = (options.createConnection ?? createGitHubMcpConnection)({ endpoint, accessToken });

  try {
    await connection.connect();
    const result = await connection.callGetMe();
    if (result?.isError === true) throw new Error('GitHub MCP returned an error from its get_me tool.');
    return { endpoint: endpoint.href, login: githubLoginFromToolResult(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactGitHubCredentials(message, [accessToken]));
  } finally {
    await connection.close().catch(() => undefined);
  }
}

function createGitHubMcpConnection({ endpoint, accessToken }) {
  const client = new Client({ name: 'agent-workspace-github-token-probe', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: githubMcpHeaders(accessToken) },
  });
  return {
    connect: () => client.connect(transport),
    callGetMe: () => client.callTool({ name: 'get_me', arguments: {} }, undefined, { timeout: 20_000 }),
    close: () => client.close(),
  };
}

async function main() {
  try {
    const result = await verifyGitHubMcpToken();
    const identity = result.login ? ` as ${result.login}` : '';
    console.log(`GitHub MCP accepted the stored ${product.name} credential${identity}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GitHub MCP credential check failed: ${redactGitHubCredentials(message)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
