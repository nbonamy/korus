import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import metadata from '../package.json';
import { fileExists, print, providerBinary, readJson, record, string, type CliContext, type CliOptions } from './context';
import { request } from './rpc';
import { tail } from './logs';
import { authentication, clientEnvironment, clientHome, clientName, type AuthStatus, type ClientId } from './providers';

type Installation = { app: { version?: string }; nodeVersion: string; home: string; sourceFolder?: string };
type Provider = { id: ClientId; installed: boolean; home: string; auth: AuthStatus | 'not-installed' | 'not-checked'; path?: string; version?: string; detail?: string };
type Progress = { checkAuth?: boolean; onInstallation?: (installation: Installation) => void; onProviderStart?: (id: ClientId) => void; onProvider?: (provider: Provider) => void };
export async function diagnose(context: CliContext, options: CliOptions, { checkAuth = false, onInstallation, onProviderStart, onProvider }: Progress = {}) {
  const checks: { id: string; status: 'ok' | 'info' | 'warning' | 'error'; detail: string }[] = [];
  const check = (id: string, status: 'ok' | 'info' | 'warning' | 'error', detail: string) => checks.push({ id, status, detail });
  const minimumNode = Number(metadata.engines.node.slice(2));
  check('runtime', Number(process.versions.node.split('.')[0]) >= minimumNode ? 'ok' : 'error', `Node ${process.version}; Node ${minimumNode} or newer is required.`);
  check('home', await fileExists(options.home) ? 'ok' : 'warning', options.home);
  let savedHomes: unknown;
  let sourceFolder: string | undefined;
  let savedConnections: unknown;
  const files: { name: string; exists: boolean; schemaVersion?: number; writtenBy?: string }[] = [];
  for (const name of ['roster.json', 'settings.json']) {
    const file = path.join(options.home, name); const exists = await fileExists(file);
    if (!exists) { files.push({ name, exists }); check(name, 'warning', 'Missing; no state was created.'); continue; }
    try {
      const envelope = await readJson(file);
      if (name === 'settings.json' && record(envelope.data)) {
        if (record(envelope.data.settings)) savedHomes = envelope.data.settings.providerHomes;
        if (record(envelope.data.sourceFolder)) sourceFolder = string(envelope.data.sourceFolder.path);
        if (record(envelope.data.workIntegrations)) savedConnections = envelope.data.workIntegrations.connections;
      }
      const schemaVersion = typeof envelope.schemaVersion === 'number' ? envelope.schemaVersion : undefined;
      files.push({ name, exists, schemaVersion, writtenBy: string(envelope.writtenBy) });
      const data = envelope.data;
      const valid = Number.isInteger(schemaVersion) && record(data) && (name === 'roster.json'
        ? Array.isArray(data.agents) && (data.missions === undefined || Array.isArray(data.missions)) : record(data.settings));
      check(name, valid ? 'ok' : 'error', valid ? `Readable envelope, schema ${schemaVersion}.` : 'Invalid saved state; no migration was attempted.');
    } catch (error) { files.push({ name, exists }); check(name, 'error', (error as Error).message); }
  }
  const appPath = context.env.KORUS_APP_PATH ?? path.join('/Applications', `${product.name}.app`);
  let appVersion: string | undefined;
  try { appVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u.exec(await readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8'))?.[1]; } catch { /* A standalone or non-macOS install need not have an app bundle. */ }
  onInstallation?.({ app: { version: appVersion }, nodeVersion: process.version, home: options.home, sourceFolder });
  let daemon: { running: boolean; version?: string; pid?: number; detail?: string };
  try {
    const health = await request(options, backendMethods.backendHealthGet);
    if (!record(health) || health.ok !== true || typeof health.version !== 'string') throw new Error('Unexpected health response.');
    daemon = { running: true, version: health.version, ...(typeof health.pid === 'number' ? { pid: health.pid } : {}) };
    check('daemon', 'ok', `${product.daemonName} ${health.version}`);
    if (appVersion && appVersion !== health.version) check('versions', 'warning', `Desktop ${appVersion} and daemon ${health.version} differ.`);
  } catch (error) { daemon = { running: false, detail: (error as Error).message }; check('daemon', 'info', 'No local socket; optional for standalone diagnostics.'); }
  const providers: Provider[] = [];
  for (const id of ['codex', 'claude', 'antigravity'] as const) {
    context.signal?.throwIfAborted();
    onProviderStart?.(id);
    const home = clientHome(context, id, savedHomes);
    const binary = await providerBinary(context, id, options.home);
    if (!binary) { const provider: Provider = { id, home, installed: false, auth: 'not-installed' }; providers.push(provider); onProvider?.(provider); continue; }
    const auth = checkAuth ? await authentication(context, options, { id, path: binary, home }) : 'not-checked';
    if (auth === 'signed-out') check(`auth:${id}`, 'warning', `${clientName(id)} is signed out.`);
    if (auth === 'unknown') check(`auth:${id}`, 'warning', `${clientName(id)} authentication could not be verified.`);
    try {
      const result = await context.exec(binary, ['--version'], { timeout: options.timeout, env: clientEnvironment(context, id, home) });
      providers.push({ id, home, auth, installed: true, path: binary, version: result.stdout.trim().slice(0, 200) });
    } catch { providers.push({ id, home, auth, installed: true, path: binary, detail: 'Version probe failed or timed out.' }); }
    onProvider?.(providers.at(-1)!);
  }
  check('providers', providers.some(provider => provider.installed) ? 'ok' : 'warning', providers.some(provider => provider.installed) ? 'Provider executables found.' : 'No supported terminal provider found on PATH or in the private bin directories.');
  const mcp = await mcpHealth(options);
  context.signal?.throwIfAborted();
  if (mcp.endpoint || options.mcpUrl) check('mcp', mcp.reachable ? 'ok' : options.mcpUrl ? 'error' : 'info', mcp.detail);
  const integrations = ['github', 'gitlab', 'linear'].map(provider => {
    const connection = Array.isArray(savedConnections) ? savedConnections.filter(record).find(connection => connection.provider === provider) : undefined;
    const status = connection?.status === 'connected' && connection.source !== 'none' ? connection.source === 'cli' ? 'Using CLI' : 'Connected' : 'Not connected';
    return { provider, status };
  });
  const servicePath = path.join(context.userHome, 'Library', 'LaunchAgents', `${product.appId}.daemon.plist`);
  const service = { supported: context.platform === 'darwin', installed: context.platform === 'darwin' && await fileExists(servicePath), path: servicePath };
  const logsPath = path.join(options.home, 'logs');
  let logBytes = 0;
  try { logBytes = (await stat(path.join(logsPath, 'daemon.log'))).size; } catch { /* Logging is optional when the daemon has never run. */ }
  return { product: product.name, cliVersion: metadata.version, generatedAt: context.now().toISOString(), nodeVersion: process.version, platform: context.platform,
    home: options.home, sourceFolder, integrations, socket: options.socket, app: { path: appPath, version: appVersion }, daemon, mcp, providers, files, service,
    logs: { path: logsPath, daemonBytes: logBytes }, checks, healthy: checks.every(item => item.status !== 'error') };
}
type DoctorReport = Awaited<ReturnType<typeof diagnose>>;
function doctorFormat(colour: boolean) {
  const paint = (code: string, text: string) => colour ? `\u001b[${code}m${text}\u001b[0m` : text;
  const clean = (text: string) => stripVTControlCharacters(text).replace(/[\r\n\t]/gu, ' ');
  const section = (title: string) => `\n${paint('1;36', title)}\n`;
  const row = (label: string, value: string, tone?: string) => `  ${paint('2', label.padEnd(16))}${tone ? paint(tone, clean(value)) : clean(value)}`;
  const heading = () => `\n${paint('1', `${product.name} doctor`)}  ${paint('2', `CLI ${metadata.version}`)}`;
  const installation = (report: Installation) => [section('Installation'), row('Desktop', report.app.version ?? 'Not detected · optional'), row('Node', report.nodeVersion), row('Home', report.home), row('Source folder', report.sourceFolder || 'Not configured')].join('\n');
  const provider = (provider: Provider, includeHeading = true) => [
    ...(includeHeading ? [section(clientName(provider.id))] : []),
    row('Version', provider.installed ? provider.version ?? provider.detail ?? 'Installed' : 'Not installed'),
    row('Auth status', { authenticated: 'Signed in', 'signed-out': 'Signed out', unknown: 'Unable to verify', 'not-installed': 'Not available', 'not-checked': 'Not checked' }[provider.auth], provider.auth === 'authenticated' ? '32' : provider.auth === 'signed-out' || provider.auth === 'unknown' ? '33' : '2'),
    row('Home', provider.home),
  ].join('\n');
  const checks = (report: DoctorReport) => {
    const markers = { ok: ['32', '✓'], info: ['2', '○'], warning: ['33', '!'], error: ['31', '×'] } as const;
    const labels: Record<string, string> = { 'roster.json': 'Conversations', 'settings.json': 'Preferences', daemon: 'Backend', versions: 'Versions', mcp: 'MCP' };
    const errors = report.checks.filter(check => check.status === 'error').length;
    const notes = report.checks.filter(check => check.status === 'warning').length;
    const summary = errors ? `${errors} ${errors === 1 ? 'issue needs' : 'issues need'} attention` : notes ? `No errors · ${notes} ${notes === 1 ? 'note' : 'notes'}` : 'All checks passed';
    return [section('Integrations'),
      ...report.integrations.map(integration => row(({ github: 'GitHub', gitlab: 'GitLab', linear: 'Linear' } as Record<string, string>)[integration.provider]!, integration.status, integration.status === 'Connected' ? '32' : integration.status === 'Using CLI' ? '33' : '2')),
      section('Checks'),
      ...report.checks.filter(check => !check.id.startsWith('auth:') && (!['runtime', 'home', 'providers'].includes(check.id) || check.status !== 'ok')).map(check => {
        const [code, symbol] = markers[check.status];
        const detail = check.id === 'daemon' && !report.daemon.running && report.mcp.reachable ? 'MCP reachable · local socket optional'
          : check.id === 'mcp' && report.mcp.reachable ? 'Responding · no agent registered' : check.detail;
        return `  ${paint(code, symbol)} ${row(labels[check.id] ?? check.id, detail).slice(2)}`;
      }), '', `${paint(errors ? '1;31' : notes ? '1;33' : '1;32', summary)}`,
      paint('2', 'Read-only · credentials, permissions, services and saved state unchanged.'),
      ...(errors ? [`Get help: ${product.slug} triage`] : []), '',
    ].join('\n');
  };
  return { heading, installation, provider, checks, section };
}
function doctorText(report: DoctorReport, colour = false): string {
  const format = doctorFormat(colour);
  return [format.heading(), format.installation(report), ...report.providers.map(provider => format.provider(provider)), format.checks(report)].join('\n');
}
export async function runDoctor(context: CliContext, options: CliOptions): Promise<number> {
  const terminal = context.interactive && !options.json && context.env.TERM !== 'dumb';
  const format = doctorFormat(terminal && context.env.NO_COLOR === undefined && context.env.TERM !== 'dumb');
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { if (timer) { clearInterval(timer); timer = undefined; context.write('\r\u001b[2K'); } };
  const spin = (label: string) => {
    if (!terminal) return;
    stop(); let index = 0; const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const draw = () => context.write(`\r\u001b[2K  ${frames[index++ % frames.length]} ${label}`);
    draw(); timer = setInterval(draw, 100); timer.unref();
  };
  if (terminal) { context.out(format.heading()); spin('Checking installation…'); }
  try {
    const report = await diagnose(context, options, { checkAuth: true,
      ...(terminal ? {
        onInstallation: (installation: Installation) => { stop(); context.out(format.installation(installation)); },
        onProviderStart: (id: ClientId) => { stop(); context.out(`${format.section(clientName(id))}\n`); spin(`Checking ${clientName(id)} authentication…`); },
        onProvider: (provider: Provider) => { stop(); context.out(format.provider(provider, false)); },
      } : {}),
    });
    stop();
    if (terminal) context.out(format.checks(report)); else print(context, options, report, doctorText(report));
    return report.healthy ? 0 : 1;
  } finally { stop(); }
}

export async function mcpHealth(options: CliOptions): Promise<{ reachable: boolean; endpoint?: string; detail: string }> {
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
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(options.timeout), ...(options.signal ? [options.signal] : [])]) });
    await response.body?.cancel();
    return { reachable: response.status === 405, endpoint: url.href, detail: response.status === 405 ? 'MCP endpoint responds. No agent was registered; this does not verify provider tool delivery.' : `MCP endpoint returned HTTP ${response.status}.` };
  } catch { return { reachable: false, endpoint: url.href, detail: 'MCP endpoint is unreachable or timed out.' }; }
}
