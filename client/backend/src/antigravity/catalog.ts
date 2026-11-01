import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { AcpConnection, record } from './acp-connection';

export type AcpCatalogEntry = { sessionId: string; cwd: string; title: string };

/** The qualified runtime exposes no timestamps or pagination in this response. */
export async function listAcpSessions(connection: AcpConnection): Promise<AcpCatalogEntry[]> {
  const result = await connection.request('session/list', {});
  if (!record(result) || !Array.isArray(result.sessions) || result.sessions.length > 10_000) throw new Error('Invalid Antigravity session catalog.');
  return result.sessions.map(value => {
    if (!record(value) || typeof value.sessionId !== 'string' || !value.sessionId || typeof value.cwd !== 'string' || !path.isAbsolute(value.cwd)) throw new Error('Invalid Antigravity session catalog entry.');
    return { sessionId: value.sessionId, cwd: value.cwd, title: typeof value.title === 'string' ? value.title : '' };
  });
}

export async function validateAcpSession(connection: AcpConnection, sessionId: string, cwd: string): Promise<void> {
  const entry = (await listAcpSessions(connection)).find(candidate => candidate.sessionId === sessionId);
  if (!entry || await realpath(entry.cwd).catch(() => null) !== await realpath(cwd)) throw new Error('Antigravity conversation is missing or belongs to another workspace.');
}
