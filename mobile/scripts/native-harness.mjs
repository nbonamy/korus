import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { mkdir, writeFile, chmod } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'mobile/.native-build/tls');
await mkdir(directory, { recursive: true, mode: 0o700 });
const openssl = (args) => {
  const result = spawnSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  if (result.status !== 0) throw new Error('OpenSSL is required to provision an isolated test CA.');
};
openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Mobile Companion Isolated Test CA']);
openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'relay.key', '-out', 'relay.csr', '-subj', '/CN=localhost']);
await writeFile(path.join(directory, 'relay.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
openssl(['x509', '-req', '-in', 'relay.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'relay.crt', '-days', '2', '-extfile', 'relay.ext']);
await Promise.all(['ca.key', 'relay.key'].map((file) => chmod(path.join(directory, file), 0o600)));
await build({ root, configFile: false, logLevel: 'warn', resolve: { alias: { '@workspace/core': path.join(root, 'core/src') } },
  build: { ssr: path.join(root, 'backend/src/companion/__tests__/live-harness.ts'), outDir: path.join(root, 'mobile/.native-build/harness'), emptyOutDir: true,
    rollupOptions: { external: [/^node:/], output: { entryFileNames: 'live.mjs', format: 'es' } } }, ssr: { noExternal: true } });
const child = spawn(process.execPath, [path.join(root, 'mobile/.native-build/harness/live.mjs')], {
  cwd: root, env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(directory, 'ca.crt') }, stdio: 'inherit',
});
process.once('SIGINT', () => child.kill('SIGINT')); process.once('SIGTERM', () => child.kill('SIGTERM'));
child.once('exit', (code) => { process.exitCode = code ?? 1; });
