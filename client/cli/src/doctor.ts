import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import metadata from '../package.json';
import { fileExists, providerBinary, readJson, record, string, type CliContext, type CliOptions } from './context';
import { request } from './rpc';
import { tail } from './logs';

export async function diagnose(context: CliContext, options: CliOptions) {
  const checks: { id: string; status: 'ok' | 'warning' | 'error'; detail: string }[] = [];
  const check = (id: string, status: 'ok' | 'warning' | 'error', detail: string) => checks.push({ id, status, detail });
  check('runtime', Number(process.versions.node.split('.')[0]) >= 26 ? 'ok' : 'error', `Node ${process.version}; Node 26 or newer is required.`);
  check('home', await fileExists(options.home) ? 'ok' : 'warning', options.home);
  const files: { name: string; exists: boolean; schemaVersion?: number; writtenBy?: string }[] = [];
  for (const name of ['roster.json', 'settings.json']) {
    const file = path.join(options.home, name); const exists = await fileExists(file);
    if (!exists) { files.push({ name, exists }); check(name, 'warning', 'Missing; no state was created.'); continue; }
    try {
      const envelope = await readJson(file);
      const schemaVersion = typeof envelope.schemaVersion === 'number' ? envelope.schemaVersion : undefined;
      files.push({ name, exists, schemaVersion, writtenBy: string(envelope.writtenBy) });
      check(name, record(envelope.data) && Number.isInteger(schemaVersion) ? 'ok' : 'error', record(envelope.data) && Number.isInteger(schemaVersion) ? `Readable envelope, schema ${schemaVersion}.` : 'Invalid state envelope; no migration was attempted.');
    } catch (error) { files.push({ name, exists }); check(name, 'error', (error as Error).message); }
  }
  const appPath = context.env.KORUS_APP_PATH ?? path.join('/Applications', `${product.name}.app`);
  let appVersion: string | undefined;
  try { appVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u.exec(await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8'))?.[1]; } catch { /* A standalone or non-macOS install need not have an app bundle. */ }
  let daemon: { running: boolean; version?: string; pid?: number; detail?: string };
  try {
    const health = await request(options, backendMethods.backendHealthGet);
    if (!record(health) || health.ok !== true || typeof health.version !== 'string') throw new Error('Unexpected health response.');
    daemon = { running: true, version: health.version, ...(typeof health.pid === 'number' ? { pid: health.pid } : {}) };
    check('daemon', 'ok', `${product.daemonName} ${health.version}`);
    if (appVersion && appVersion !== health.version) check('versions', 'warning', `Desktop ${appVersion} and daemon ${health.version} differ.`);
  } catch (error) { daemon = { running: false, detail: (error as Error).message }; check('daemon', 'warning', daemon.detail!); }
  const providers: { id: string; installed: boolean; path?: string; version?: string; detail?: string }[] = [];
  for (const id of ['codex', 'claude', 'antigravity'] as const) {
    const binary = await providerBinary(context, id, options.home);
    if (!binary) { providers.push({ id, installed: false }); continue; }
    try {
      const result = await context.exec(binary, ['--version'], { timeout: options.timeout });
      providers.push({ id, installed: true, path: binary, version: result.stdout.trim().slice(0, 200) });
    } catch { providers.push({ id, installed: true, path: binary, detail: 'Version probe failed or timed out.' }); }
  }
  check('providers', providers.some(provider => provider.installed) ? 'ok' : 'warning', providers.some(provider => provider.installed) ? 'Provider executables found. Authentication was not read or changed.' : 'No supported terminal provider found on PATH or in the private bin directories.');
  const mcp = await mcpHealth(options);
  if (mcp.endpoint || options.mcpUrl) check('mcp', mcp.reachable ? 'ok' : 'warning', mcp.detail);
  const servicePath = path.join(context.userHome, 'Library', 'LaunchAgents', `${product.appId}.daemon.plist`);
  const service = { supported: context.platform === 'darwin', installed: context.platform === 'darwin' && await fileExists(servicePath), path: servicePath };
  const logsPath = path.join(options.home, 'logs');
  let logBytes = 0;
  try { logBytes = (await stat(path.join(logsPath, 'daemon.log'))).size; } catch { /* Logging is optional when the daemon has never run. */ }
  return { product: product.name, cliVersion: metadata.version, generatedAt: context.now().toISOString(), nodeVersion: process.version, platform: context.platform,
    home: options.home, socket: options.socket, app: { path: appPath, version: appVersion }, daemon, mcp, providers, files, service,
    logs: { path: logsPath, daemonBytes: logBytes }, checks, healthy: checks.every(item => item.status === 'ok') };
}
export function doctorText(report: Awaited<ReturnType<typeof diagnose>>): string {
  return [`${product.name} doctor · CLI ${report.cliVersion}`, `Installed desktop: ${report.app.version ?? 'not detected'}`,
    ...report.providers.map(provider => `${provider.id}: ${provider.installed ? provider.version ?? provider.detail ?? 'installed' : 'not found'}`), ...report.checks.map(check => `${check.status.toUpperCase()} ${check.id}: ${check.detail}`),
    'Read-only: credentials, permissions, service configuration and saved state were not changed.'].join('\n');
}

async function mcpHealth(options: CliOptions): Promise<{ reachable: boolean; endpoint?: string; detail: string }> {
  let endpoint = options.mcpUrl;
  if (!endpoint) {
    try {
      for (const line of (await tail(path.join(options.home, 'logs', 'daemon.log'))).reverse()) {
        let entry: unknown; try { entry = JSON.parse(line); } catch { continue; }
        if (record(entry) && entry.area === 'mcp-http' && entry.msg === 'listening' && typeof entry.url === 'string') { endpoint = entry.url; break; }
      }
    } catch { /* No recent endpoint metadata. */ }
  }
  if (!endpoint) return { reachable: false, detail: 'No MCP endpoint in recent logs. Use --mcp-url to probe one explicitly.' };
  let url: URL;
  try { url = new URL(endpoint); } catch { return { reachable: false, detail: 'Invalid MCP endpoint.' }; }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/mcp') {
    return { reachable: false, detail: 'Only http://127.0.0.1 or http://[::1] /mcp endpoints may be probed.' };
  }
  url.search = ''; url.hash = '';
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(options.timeout) });
    await response.body?.cancel();
    return { reachable: response.status === 405, endpoint: url.href, detail: response.status === 405 ? 'MCP endpoint responds. No agent was registered; this does not verify provider tool delivery.' : `MCP endpoint returned HTTP ${response.status}.` };
  } catch { return { reachable: false, endpoint: url.href, detail: 'MCP endpoint is unreachable or timed out.' }; }
}
