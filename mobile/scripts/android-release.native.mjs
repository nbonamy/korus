import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, X509Certificate } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const javaHome = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const sdk = process.env.ANDROID_HOME || path.join(homedir(), 'Library/Android/sdk');
const keytool = path.join(javaHome, 'bin/keytool');
const jarsigner = path.join(javaHome, 'bin/jarsigner');
const signingKeys = ['APP_ANDROID_KEYSTORE', 'APP_ANDROID_KEY_ALIAS', 'APP_ANDROID_KEYSTORE_PASSWORD', 'APP_ANDROID_KEY_PASSWORD'];
const buildEnv = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk };
for (const name of signingKeys) delete buildEnv[name];

function run(command, args, env) {
  return spawnSync(command, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

// Real Gradle signing protects the release artifact boundary; no source/config assertions.
// Run explicitly with the Android SDK and JDK installed. This never installs an app.
test('release refuses absent or partial signing credentials and signs both artifacts with the supplied key', { timeout: 300_000 }, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'korus-android-signing-'));
  try {
    for (const env of [buildEnv, { ...buildEnv, APP_ANDROID_KEY_ALIAS: 'incomplete' }]) {
      const result = run(process.execPath, ['mobile/scripts/android.mjs', '--release'], env);
      assert.notEqual(result.status, 0, 'A requested release must not silently build debug or unsigned artifacts');
      assert.match(result.stderr, /signing/i);
    }

    const password = randomBytes(24).toString('hex');
    const env = { ...buildEnv, APP_ANDROID_KEYSTORE: path.join(temporary, 'upload.p12'), APP_ANDROID_KEY_ALIAS: 'upload-test',
      APP_ANDROID_KEYSTORE_PASSWORD: password, APP_ANDROID_KEY_PASSWORD: password };
    const generated = run(keytool, ['-genkeypair', '-keystore', env.APP_ANDROID_KEYSTORE, '-storetype', 'PKCS12',
      '-alias', env.APP_ANDROID_KEY_ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-dname', 'CN=Android release verification', '-storepass:env', 'APP_ANDROID_KEYSTORE_PASSWORD', '-keypass:env', 'APP_ANDROID_KEY_PASSWORD'], env);
    assert.equal(generated.status, 0, 'The JDK must create a disposable verification key');
    const certificate = run(keytool, ['-exportcert', '-rfc', '-keystore', env.APP_ANDROID_KEYSTORE, '-alias', env.APP_ANDROID_KEY_ALIAS,
      '-storepass:env', 'APP_ANDROID_KEYSTORE_PASSWORD'], env);
    assert.equal(certificate.status, 0);
    const expected = new X509Certificate(certificate.stdout).fingerprint256;

    const result = run(process.execPath, ['mobile/scripts/android.mjs', '--release'], env);
    const log = path.join(tmpdir(), 'korus-android-release-signing-build.log');
    await writeFile(log, `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
    assert.equal(result.status, 0, `Release build failed; see ${log}`);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(password), 'Signing passwords must not appear in build output');
    const bundle = path.join(root, 'mobile/android/app/build/outputs/bundle/release/app-release.aab');
    const verified = run(jarsigner, ['-verify', bundle], env);
    assert.equal(verified.status, 0, 'The release bundle signature must verify');
    assert.match(verified.stdout, /jar verified/);
    const signer = run(keytool, ['-printcert', '-rfc', '-jarfile', bundle], env);
    assert.equal(signer.status, 0);
    assert.equal(new X509Certificate(signer.stdout).fingerprint256, expected, 'The AAB must use the supplied upload certificate');
    const apk = path.join(root, 'mobile/android/app/build/outputs/apk/release/app-release.apk');
    const apkVerified = run(path.join(sdk, 'build-tools/36.0.0/apksigner'), ['verify', '--print-certs', apk], env);
    assert.equal(apkVerified.status, 0, 'The signed release APK must verify');
    assert.match(apkVerified.stdout, new RegExp(expected.replaceAll(':', '').toLowerCase()));
    const generatedProduct = await readFile(path.join(root, 'mobile/android/app/src/main/assets/product.json'), 'utf8');
    assert.ok(!generatedProduct.includes(password) && !generatedProduct.includes(env.APP_ANDROID_KEYSTORE), 'Generated client assets must not contain signing credentials');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
