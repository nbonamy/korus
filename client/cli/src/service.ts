import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { CliError, fileExists, print, record, type CliContext, type CliOptions } from './context';
import { request } from './rpc';
import { mcpHealth } from './doctor';

export async function backendCommand(context: CliContext, options: CliOptions, action: string): Promise<number> {
  const label = `${product.appId}.daemon`;
  const file = path.join(context.userHome, 'Library', 'LaunchAgents', `${label}.plist`);
  if (action === 'status') {
    let health: unknown;
    try { health = await request(options, backendMethods.backendHealthGet); } catch { health = { ok: false }; }
    const socketResponding = record(health) && health.ok === true;
    const mcp = socketResponding ? undefined : await mcpHealth(options);
    const running = socketResponding || mcp?.reachable === true;
    const transport = socketResponding ? 'socket' : mcp?.reachable ? 'mcp' : null;
    const result = { running, transport, serviceInstalled: context.platform === 'darwin' && await fileExists(file), socket: options.socket, health, mcp };
    const colour = context.interactive && context.env.NO_COLOR === undefined && context.env.TERM !== 'dumb';
    const paint = (code: string, text: string) => colour ? `\u001b[${code}m${text}\u001b[0m` : text;
    const lines = [paint('1;36', `${product.name} backend`), '',
      `  Status          ${paint(running ? '32' : '2', running ? 'Responding' : 'No connection detected')}`,
      `  Connection      ${socketResponding ? 'Local socket' : mcp?.reachable ? 'MCP' : '—'}`,
      ...(socketResponding && record(health) && typeof health.version === 'string' ? [`  Version         ${health.version}`] : []),
      `  Background      ${result.serviceInstalled ? 'Installed' : 'Not installed'}`, '',
    ];
    print(context, options, result, lines.join('\n'));
    return 0;
  }
  if (!['start', 'stop', 'restart'].includes(action)) throw new CliError('Use backend status, start, stop, or restart.', 2);
  if (context.platform !== 'darwin') throw new CliError('Background service control is supported on macOS. Doctor and live daemon commands remain available.');
  if (!await fileExists(file)) throw new CliError('The background backend is not installed. Enable it in desktop Settings first.');
  const plist = await readFile(file, 'utf8');
  const configured = /<key>APP_HOME<\/key>\s*<string>([^<]+)<\/string>/u.exec(plist)?.[1]
    ?.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
  if (!configured || path.resolve(configured) !== options.home) throw new CliError('LaunchAgent APP_HOME does not match the selected home; refusing to control another installation.');
  if (!options.yes && (!context.interactive || !/^(y|yes)$/iu.test((await context.ask(`${action} the background backend? Active agent turns may be interrupted. [y/N] `)).trim()))) {
    throw new CliError('No change made. Pass --yes to confirm backend service control.');
  }
  const domain = `gui/${process.getuid?.() ?? 501}`;
  if (action === 'stop') await context.exec('launchctl', ['bootout', domain, file], { timeout: options.timeout });
  else {
    if (action === 'start') {
      let loaded = true; try { await context.exec('launchctl', ['print', `${domain}/${label}`], { timeout: options.timeout }); } catch { loaded = false; }
      if (!loaded) await context.exec('launchctl', ['bootstrap', domain, file], { timeout: options.timeout });
    }
    await context.exec('launchctl', ['kickstart', ...(action === 'restart' ? ['-k'] : []), `${domain}/${label}`], { timeout: options.timeout });
  }
  print(context, options, { success: true, action }, `${product.name} background backend: ${action} requested.`);
  return 0;
}
