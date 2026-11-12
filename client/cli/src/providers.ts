import path from 'node:path';
import { record, type CliContext, type CliOptions } from './context';

export type ClientId = 'claude' | 'codex' | 'antigravity';
export type AuthStatus = 'authenticated' | 'signed-out' | 'unknown';
export const clientName = (id: string) => id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'Antigravity';
export function clientHome(context: CliContext, id: ClientId, savedHomes?: unknown): string {
  const saved = record(savedHomes) ? savedHomes[id] : undefined;
  if (record(saved) && typeof saved.homePath === 'string' && saved.homePath.trim()) return path.resolve(context.cwd, saved.homePath);
  // Antigravity's CLI has one home and reads no variable for it.
  if (id === 'antigravity') return path.join(context.userHome, '.gemini');
  const [key, directory] = id === 'codex' ? ['CODEX_HOME', '.codex'] : ['CLAUDE_CONFIG_DIR', '.claude'];
  return path.resolve(context.cwd, context.env[key]?.trim() || path.join(context.userHome, directory));
}
export function clientEnvironment(context: CliContext, id: ClientId, home: string): NodeJS.ProcessEnv {
  // Antigravity's sign-in is the machine's; a separate home only holds the conversations Korus runs.
  if (id === 'antigravity') return { ...context.env };
  return { ...context.env, [id === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']: home };
}
export async function authentication(context: CliContext, options: CliOptions, client: { id: ClientId; path: string; home?: string }): Promise<AuthStatus> {
  // Bounded status commands only; never retain account details, credentials or raw probe errors.
  try {
    const args = client.id === 'claude' ? ['auth', 'status', '--json'] : client.id === 'codex' ? ['login', 'status'] : ['models'];
    const result = await context.exec(client.path, args, { timeout: options.timeout, env: clientEnvironment(context, client.id, client.home ?? clientHome(context, client.id)) });
    if (client.id === 'claude') {
      const status: unknown = JSON.parse(result.stdout);
      return record(status) && typeof status.loggedIn === 'boolean' ? status.loggedIn ? 'authenticated' : 'signed-out' : 'unknown';
    }
    if (client.id === 'codex') {
      const text = `${result.stdout}\n${result.stderr}`;
      return /^Logged in\b/imu.test(text) ? 'authenticated' : /^Not logged in\b/imu.test(text) ? 'signed-out' : 'unknown';
    }
    // Antigravity exposes no auth-status command; fetching its model catalog requires authentication.
    return /^[a-z0-9][a-z0-9._/-]*\t\S/imu.test(result.stdout) ? 'authenticated' : 'unknown';
  } catch (error) {
    context.signal?.throwIfAborted();
    if (client.id === 'claude' && record(error) && typeof error.stdout === 'string') {
      try { const status: unknown = JSON.parse(error.stdout); if (record(status) && status.loggedIn === false) return 'signed-out'; } catch { /* Not an authentication response. */ }
    }
    // Codex returns a nonzero status when explicitly signed out. Other failures remain unknown.
    return client.id === 'codex' && record(error) && typeof error.stderr === 'string' && /^Not logged in\b/imu.test(error.stderr) ? 'signed-out' : 'unknown';
  }
}
