import { parseArgs } from 'node:util';
import path from 'node:path';
import { product } from '@workspace/core/product';
import metadata from '../package.json';
import { appHome, CliError, nodeContext, print, redact, type CliContext, type CliOptions } from './context';
import { runDoctor } from './doctor';
import { followLogs, readLogs } from './logs';
import { backendCommand } from './service';
import { loadState } from './state';
import { supportBundle, triage } from './triage';

const help = `${product.name} CLI ${metadata.version}
Usage: ${product.slug} <command> [options]

  doctor                     Read-only health report; works without the app or daemon
  triage [description]       Start terminal support with machine context and a playbook
  backend status             Inspect the existing daemon connection
  backend start|stop|restart  Control the installed macOS background service (--yes)
  logs                       Show redacted recent logs (--since 15m --agent ID --follow)
  support bundle             Prepare a private diagnostic bundle; never uploads
  agents list                List agents
  missions list|show ID       Inspect Mission progress without changing its stage

Options:
  --home PATH       Application home (defaults to APP_HOME, KORUS_HOME, then ~/${product.homeDirectory})
  --socket PATH     Existing daemon socket
  --timeout MS      Bounded probe/request timeout, 1–60000 (default 2500)
  --json            JSON output (NDJSON while following logs); triage does not launch
  --offline         Read saved roster metadata without connecting (inspection only)
  --agent ID        Filter logs, or choose claude/codex/antigravity/auto for triage
  --model NAME      Pass a model to the selected triage provider
  --no-launch       Prepare triage files without starting a provider
  --output PATH     Parent directory for triage/support files
  --lines N         Maximum recent log rows, 1–10000 (default 100)
  --follow          Stream new log entries until interrupted; works with pipes
  --since 15m       Filter logs by age (s, m, h, d) or ISO timestamp
  --mcp-url URL     Probe an explicit loopback MCP endpoint without registering an agent
  --include-logs    Include redacted log excerpts in a support bundle (review before sharing)
  --yes             Confirm background-service control
  --help, --version
`;
function positive(value: string | undefined, fallback: number, maximum: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new CliError(`${flag} must be an integer from 1 to ${maximum}.`, 2);
  return parsed;
}
function since(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const relative = /^(\d+)(s|m|h|d)$/u.exec(value);
  const result = relative ? now - Number(relative[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[relative[2]!]!) : Date.parse(value);
  if (!Number.isFinite(result)) throw new CliError('--since must be an age such as 15m or an ISO timestamp.', 2);
  return result;
}
function validateCommand(positionals: string[], flags: Record<string, unknown>): void {
  const [command, action, id] = positionals;
  const valid = command === 'triage'
    || (['doctor', 'logs'].includes(command!) && positionals.length === 1)
    || (command === 'backend' && positionals.length <= 2 && (!action || ['status', 'start', 'stop', 'restart'].includes(action)))
    || (command === 'agents' && positionals.length <= 2 && (!action || action === 'list'))
    || (command === 'missions' && (positionals.length <= 2 && (!action || action === 'list') || positionals.length === 3 && action === 'show' && !!id?.trim()))
    || (command === 'support' && positionals.length === 2 && action === 'bundle');
  if (!valid) throw new CliError(`Invalid command. Run ${product.slug} --help.`, 2);
  const allowed: Record<string, string[]> = { doctor: ['mcp-url'], triage: ['agent', 'model', 'no-launch', 'output'],
    backend: !action || action === 'status' ? ['mcp-url'] : ['yes'], logs: ['lines', 'since', 'agent', 'follow'],
    support: ['output', 'include-logs'], agents: ['offline'], missions: ['offline'] };
  for (const flag of Object.keys(flags)) if (!['home', 'socket', 'timeout', 'json', ...(allowed[command!] ?? [])].includes(flag)) {
    throw new CliError(`--${flag} is not available for ${command}${action ? ` ${action}` : ''}.`, 2);
  }
}
export async function runCli(args: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const context = nodeContext(overrides);
  try {
    context.signal?.throwIfAborted();
    let parsed: ReturnType<typeof parseArgs>;
    try { parsed = parseArgs({ args, allowPositionals: true, options: {
      home: { type: 'string' }, socket: { type: 'string' }, timeout: { type: 'string' }, json: { type: 'boolean' }, offline: { type: 'boolean' },
      yes: { type: 'boolean' }, agent: { type: 'string' }, model: { type: 'string' }, 'no-launch': { type: 'boolean' }, output: { type: 'string' },
      lines: { type: 'string' }, since: { type: 'string' }, follow: { type: 'boolean' }, 'mcp-url': { type: 'string' }, 'include-logs': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    } }); } catch (error) { throw new CliError((error as Error).message, 2); }
    const values = parsed.values;
    const text = (key: string): string | undefined => typeof values[key] === 'string' ? values[key] as string : undefined;
    if (values.version) { context.out(`${product.slug} ${metadata.version}`); return 0; }
    if (values.help || !parsed.positionals.length) { context.out(help); return 0; }
    validateCommand(parsed.positionals, values);
    const home = appHome(context, text('home'));
    const options: CliOptions = { home, socket: text('socket') ?? (context.env.APP_BACKEND_SOCKET?.trim() || path.join(home, 'daemon.sock')),
      timeout: positive(text('timeout'), 2500, 60000, '--timeout'), json: !!values.json, offline: !!values.offline, yes: !!values.yes,
      lines: positive(text('lines'), 100, 10000, '--lines'), since: since(text('since'), context.now().getTime()), agent: text('agent'), model: text('model'),
      noLaunch: !!values['no-launch'], output: text('output') ? path.resolve(context.cwd, text('output')!) : undefined, follow: !!values.follow, mcpUrl: text('mcp-url'), includeLogs: !!values['include-logs'], signal: context.signal };
    const [command, action, ...rest] = parsed.positionals;
    if (command === 'doctor') return await runDoctor(context, options);
    if (command === 'triage') return await triage(context, options, [action, ...rest].filter(Boolean).join(' '));
    if (command === 'support' && action === 'bundle') return await supportBundle(context, options);
    if (command === 'backend') return await backendCommand(context, options, action ?? 'status');
    if (command === 'logs') {
      if (options.follow) { await followLogs(context, options); context.signal?.throwIfAborted(); return 0; }
      const entries = await readLogs(context, options);
      print(context, options, { entries }, entries.map(entry => `${entry.file}: ${entry.text}`).join('\n') || 'No matching logs.');
      return 0;
    }
    if (command === 'agents') {
      if ((action ?? 'list') !== 'list') throw new CliError('Use agents list.', 2);
      const state = await loadState(options);
      print(context, options, { source: state.source, agents: state.agents }, `Agents\n${state.agents.map(agent => `${agent.id}\t${agent.name}\t${agent.backend}\t${agent.status}`).join('\n') || 'No agents found.'}`); return 0;
    }
    if (command === 'missions' && ['list', 'show'].includes(action ?? 'list')) {
      const state = await loadState(options);
      const mission = action === 'show' ? state.missions.find(mission => mission.id === rest[0]) : undefined;
      if (action === 'show' && !mission) throw new CliError('Mission not found. Run missions list.');
      const data = mission ? { source: state.source, mission } : { source: state.source, missions: state.missions };
      print(context, options, data, `Missions\n${mission ? JSON.stringify(mission, null, 2) : state.missions.map(mission => `${mission.id}\t${mission.outcome}\t${mission.stage}\t${mission.tickets.filter(ticket => ticket.done).length}/${mission.tickets.length}`).join('\n') || 'No missions found.'}`); return 0;
    }
    throw new CliError(`Unknown command. Run ${product.slug} --help.`, 2);
  } catch (error) {
    const cancelled = context.signal?.aborted || error instanceof Error && error.name === 'AbortError';
    if (cancelled) { context.err('Cancelled.'); return context.signal?.reason instanceof CliError ? context.signal.reason.exitCode : 130; }
    const message = error instanceof Error ? error.message : 'Command failed.';
    context.err(redact(message, context, appHome(context)));
    return error instanceof CliError ? error.exitCode : 1;
  }
}
