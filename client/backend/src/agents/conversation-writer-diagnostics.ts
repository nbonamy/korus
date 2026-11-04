import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);
type Run = (program: string, args: string[]) => Promise<string>;

/** Candidates and their state homes, not a claim that another process owns a particular thread. */
export async function conversationWriterDiagnostics(run: Run = async (program, args) => (
  await execute(program, args, { timeout: 1500, maxBuffer: 1024 * 1024 })
).stdout, platform: NodeJS.Platform = process.platform): Promise<Record<string, unknown>> {
  if (platform === 'win32') return { platform, daemonPid: process.pid };
  const rows = (await run('ps', ['-axo', 'pid=,ppid=,comm='])).split('\n');
  const processes = rows.flatMap(row => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(row);
    if (!match || !/(?:^|\/)codex(?:\.exe)?$/.test(match[3]!)) return [];
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), executable: match[3]!, stateHomes: [] as string[] }];
  });
  if (processes.length) {
    const files = await run('lsof', ['-a', '-p', processes.map(item => item.pid).join(','), '-Fn']).catch(() => '');
    let current: typeof processes[number] | undefined;
    for (const line of files.split('\n')) {
      if (line.startsWith('p')) current = processes.find(item => item.pid === Number(line.slice(1)));
      else if (current && /^n.*\/(?:state|logs|queue|goals|memories)_\d+\.sqlite(?:-shm|-wal)?$/.test(line)) {
        const home = path.posix.dirname(line.slice(1));
        if (!current.stateHomes.includes(home)) current.stateHomes.push(home);
      }
    }
  }
  return { platform, daemonPid: process.pid, processes };
}
