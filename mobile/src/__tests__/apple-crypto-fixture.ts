import { createContext, runInContext } from 'node:vm';
import { createHash, createPrivateKey, createPublicKey, createCipheriv, createDecipheriv, diffieHellman, generateKeyPairSync, hkdfSync, sign, verify } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';

const root = path.resolve(__dirname, '../../..');
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64');
const raw = (key: ReturnType<typeof createPrivateKey>) => Buffer.from(key.export({ format: 'jwk' }).d!, 'base64url');
const pub = (key: ReturnType<typeof createPublicKey>) => Buffer.from(key.export({ format: 'jwk' }).x!, 'base64url');
const privateKey = (data: Uint8Array, agreement = false) => createPrivateKey({ key: Buffer.concat([Buffer.from(agreement ? '302e020100300506032b656e04220420' : '302e020100300506032b657004220420', 'hex'), Buffer.from(data).subarray(0, 32)]), type: 'pkcs8', format: 'der' });
const publicKey = (data: Uint8Array, agreement = false) => createPublicKey({ key: Buffer.concat([Buffer.from(agreement ? '302a300506032b656e032100' : '302a300506032b6570032100', 'hex'), Buffer.from(data)]), type: 'spki', format: 'der' });

/** OS boundary fake for Linux CI; APPLE_CRYPTO_NATIVE_TEST=1 runs identical tests against actual Swift/CryptoKit. */
export async function cryptoFixture() {
  const build = await rolldown({ input: path.join(root, 'mobile/native/noise-session.js') });
  const bundle = await build.generate({ format: 'iife' }); await build.close();
  const script = bundle.output.find(chunk => chunk.type === 'chunk')!.code;
  if (process.env.APPLE_CRYPTO_NATIVE_TEST === '1') {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'companion-crypto-'));
    const executable = path.join(folder, 'crypto');
    execFileSync('xcrun', ['swiftc', path.join(root, 'mobile/ios/Sources/Crypto/AppleCrypto.swift'), path.join(root, 'mobile/scripts/apple-crypto-runner.swift'), '-o', executable]);
    const { writeFileSync } = await import('node:fs'); writeFileSync(path.join(folder, 'noise.js'), script);
    const child = spawn(executable, [path.join(folder, 'noise.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    const queue: { resolve(value: any): void; reject(error: Error): void }[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { const item = queue.shift(); const data = JSON.parse(line); if (data.error) item?.reject(new Error(data.error)); else item?.resolve(data.result); });
    child.on('exit', () => { for (const item of queue.splice(0)) item.reject(new Error('Crypto service exited')); });
    return { async call(command: any): Promise<any> { return new Promise((resolve, reject) => { queue.push({ resolve, reject }); child.stdin.write(JSON.stringify(command) + '\n'); }); },
      async close() { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); lines.close(); rmSync(folder, { recursive: true }); } };
  }
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, nativeCrypto: (op: string, args: any) => {
    const { data, key, nonce, ad } = args;
    switch (op) {
      case 'utf8': return new TextEncoder().encode(args.text);
      case 'decode': return new Uint8Array(Buffer.from(data, 'base64'));
      case 'encode': return b64(data);
      case 'keypair': { const pair = generateKeyPairSync('x25519'); return { privateKey: new Uint8Array(raw(pair.privateKey)), publicKey: new Uint8Array(pub(pair.publicKey)) }; }
      case 'dh': return new Uint8Array(diffieHellman({ privateKey: privateKey(key, true), publicKey: publicKey(args.pub, true) }));
      case 'hash': return new Uint8Array(createHash('sha256').update(data).digest());
      case 'hkdf': return new Uint8Array(hkdfSync('sha256', data, key, '', 96));
      case 'encrypt': { const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); cipher.setAAD(ad, { plaintextLength: data.length }); return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])); }
      case 'decrypt': { const cipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); cipher.setAAD(ad, { plaintextLength: data.length - 16 }); cipher.setAuthTag(data.subarray(-16)); return new Uint8Array(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()])); }
      default: throw Error('Unsupported primitive');
    }
  } });
  runInContext(script, context);
  return { async call(command: any): Promise<any> {
    if (command.op === 'identity.generate') { const pair = generateKeyPairSync('ed25519'); return { privateKey: b64(Buffer.concat([raw(pair.privateKey), pub(pair.publicKey)])) }; }
    const data = () => Buffer.from(command.data, 'base64');
    if (command.op === 'identity.sign') {
      const rawKey = Buffer.from(command.key, 'base64'); const key = privateKey(rawKey);
      if (!pub(createPublicKey(key)).equals(rawKey.subarray(32))) throw Error('Invalid identity');
      return { signature: b64(sign(null, data(), key)) };
    }
    if (command.op === 'identity.verify') return { valid: verify(null, data(), publicKey(Buffer.from(command.key, 'base64')), Buffer.from(command.signature, 'base64')) };
    return JSON.parse(context.noiseSession(command));
  }, async close() {} };
}
