import { spawn } from 'node:child_process';

// Probe Korus's own runtime. Provider executables and accounts are not prerequisites.
export function checkPackagedDaemon(node, daemon, env, version, { requireClaude = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [daemon, '--stdio'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let completed = false;
    let failure;
    let killTimer;
    const pending = new Set([1, 2]);
    const timer = setTimeout(() => finish(new Error('Packaged daemon check timed out.')), 30_000);
    function finish(error) {
      if (completed) return;
      completed = true;
      failure = error;
      clearTimeout(timer);
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }
    child.once('error', finish);
    child.once('close', () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (!completed) failure = new Error(`Packaged daemon exited before completing checks: ${stderr}`);
      failure ? reject(failure) : resolve();
    });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
    child.stdout.on('data', bytes => {
      buffer += bytes;
      while (!completed && buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const reply = JSON.parse(line);
          if (!pending.has(reply.id)) continue;
          if (reply.error) throw new Error(reply.error.message);
          if (reply.id === 1 && (reply.result?.ok !== true || reply.result.version !== version)) {
            throw new Error('Incorrect packaged daemon health/version.');
          }
          if (reply.id === 2 && (!Array.isArray(reply.result)
            || !['codex', 'claude'].every(backend => reply.result.some(provider => provider.backend === backend && typeof provider.installed === 'boolean')))) {
            throw new Error('Packaged daemon did not return provider detection status.');
          }
          if (reply.id === 2 && requireClaude && !reply.result.some(provider => provider.backend === 'claude' && provider.installed === true)) {
            throw new Error('Packaged Claude runtime was not detected.');
          }
          pending.delete(reply.id);
          if (!pending.size) finish();
        } catch (error) { finish(error); }
      }
    });
    child.stdin.on('error', finish);
    for (const [id, method] of [[1, 'backend/health/get'], [2, 'provider/setup/get']]) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method }) + '\n');
    }
  });
}
