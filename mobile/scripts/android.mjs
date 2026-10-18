import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url));
const android = path.join(root, 'mobile/android');
const buildEnv = { ...process.env };
const release = process.argv.includes('--release');
const testing = process.argv.includes('--test');
if (release && (testing || process.argv.includes('--assets-only'))) throw new Error('Choose release, tests, or assets-only separately.');
if (release && ['APP_ANDROID_KEYSTORE', 'APP_ANDROID_KEY_ALIAS', 'APP_ANDROID_KEYSTORE_PASSWORD', 'APP_ANDROID_KEY_PASSWORD'].some(name => !buildEnv[name])) {
  throw new Error('Release signing requires APP_ANDROID_KEYSTORE, APP_ANDROID_KEY_ALIAS, APP_ANDROID_KEYSTORE_PASSWORD and APP_ANDROID_KEY_PASSWORD.');
}
if (process.platform === 'darwin') {
  buildEnv.JAVA_HOME ||= '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  buildEnv.ANDROID_HOME ||= path.join(os.homedir(), 'Library/Android/sdk');
}
const product = JSON.parse(await fs.readFile(path.join(root, 'core/src/product.json'), 'utf8'));
const relay = {
  origin: process.env.APP_COMPANION_RELAY_URL || product.companionRelay.origin,
  peerId: process.env.APP_COMPANION_RELAY_PEER_ID || product.companionRelay.peerId,
};
if (Boolean(process.env.APP_COMPANION_RELAY_URL) !== Boolean(process.env.APP_COMPANION_RELAY_PEER_ID)) {
  throw new Error('Set both companion relay overrides together.');
}
const main = path.join(android, 'app/src/main');
let firebase;
try {
  const config = JSON.parse(await fs.readFile(process.env.APP_COMPANION_FIREBASE_CONFIG || path.join(android, 'app/google-services.json'), 'utf8'));
  const client = config.client.find(client => client.client_info.android_client_info.package_name === product.appId);
  if (!client) throw new Error('Firebase configuration has no matching Android application.');
  firebase = { packageName: product.appId, appId: client.client_info.mobilesdk_app_id, apiKey: client.api_key[0].current_key,
    projectId: config.project_info.project_id, senderId: config.project_info.project_number };
} catch (error) {
  if (error.code !== 'ENOENT' || process.env.APP_COMPANION_FIREBASE_CONFIG) throw error;
}
await fs.mkdir(path.join(main, 'assets'), { recursive: true });
await fs.mkdir(path.join(main, 'res/drawable'), { recursive: true });
await fs.mkdir(path.join(main, 'res/drawable-nodpi'), { recursive: true });
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
await fs.writeFile(path.join(main, 'assets/product.json'), JSON.stringify({ name: product.companionName, desktopName: product.name, relay, firebase, privacyUrl: new URL('/privacy/', product.websiteUrl).href }));
await fs.writeFile(path.join(main, 'res/values/product.xml'), `<resources><string name="app_name">${escape(product.companionName)}</string></resources>\n`);
await fs.copyFile(path.join(root, 'electron/assets/icon-square.png'), path.join(main, 'res/drawable-nodpi/app_icon.png'));
await fs.rm(path.join(main, 'res/drawable/app_icon.png'), { force: true });
// The canonical SVG owns the artwork and colors. Android owns its native mask,
// safe-zone placement and monochrome layer; no separate copy of the brand paths.
const svg = await fs.readFile(path.join(root, 'electron/assets/icon.svg'), 'utf8');
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
const dimensions = attribute(svg, 'viewBox')?.split(/\s+/).map(Number);
const mark = svg.match(/<g\s+transform="translate\(([-\d.]+)\s+([-\d.]+)\)"\s+fill="(#[\da-f]+)">([\s\S]*?)<\/g>/i);
const gradient = svg.match(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/);
const background = svg.match(/<path\s+fill="url\(#([^)]+)\)"\s+d="([^"]+)"\s*\/>/);
const paths = [...(mark?.[4] || '').matchAll(/<path\s+d="([^"]+)"\s*\/>/g)];
const stops = [...(gradient?.[2] || '').matchAll(/<stop\b([^>]*)\/>/g)];
if (!dimensions || dimensions.length !== 4 || dimensions.some(value => !Number.isFinite(value)) || dimensions[0] !== 0 || dimensions[1] !== 0
    || !mark || !paths.length || !gradient || !stops.length || !background || background[1] !== attribute(gradient[1], 'id')) {
  throw new Error('The canonical icon SVG needs an updated Android vector conversion.');
}
const [, , width, height] = dimensions;
const vector = body => `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="108dp" android:height="108dp" android:viewportWidth="${width}" android:viewportHeight="${height}">${body}</vector>\n`;
const foreground = vector(`<group android:pivotX="${width / 2}" android:pivotY="${height / 2}" android:scaleX="0.8" android:scaleY="0.8"><group android:translateX="${mark[1]}" android:translateY="${mark[2]}">${paths.map(path => `<path android:fillColor="${mark[3]}" android:pathData="${escape(path[1])}"/>`).join('')}</group></group>`);
const coordinate = (name, size) => {
  const value = Number(attribute(gradient[1], name));
  if (!Number.isFinite(value)) throw new Error('The canonical icon gradient needs numeric coordinates.');
  return value * size;
};
const backgroundVector = vector(`<path android:pathData="${escape(background[2])}"><aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="${coordinate('x1', width)}" android:startY="${coordinate('y1', height)}" android:endX="${coordinate('x2', width)}" android:endY="${coordinate('y2', height)}">${stops.map(stop => {
  const offset = attribute(stop[1], 'offset'); const color = attribute(stop[1], 'stop-color');
  if (!offset || !Number.isFinite(Number(offset)) || !/^#[\da-f]{6}$/i.test(color || '')) throw new Error('The canonical icon gradient needs supported color stops.');
  return `<item android:offset="${offset}" android:color="${color}"/>`;
}).join('')}</gradient></aapt:attr></path>`);
await fs.writeFile(path.join(main, 'res/drawable/app_launcher_foreground.xml'), foreground);
await fs.writeFile(path.join(main, 'res/drawable/app_launcher_background.xml'), backgroundVector);
for (const api of [26, 33]) {
  const directory = path.join(main, `res/mipmap-anydpi-v${api}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'app_launcher.xml'), `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/app_launcher_background"/><foreground android:drawable="@drawable/app_launcher_foreground"/>${api >= 33 ? '<monochrome android:drawable="@drawable/app_launcher_foreground"/>' : ''}</adaptive-icon>\n`);
}
const build = spawnSync('npm', ['run', 'build:web', '-w', '@workspace/mobile'], { cwd: root, stdio: 'inherit', env: { ...process.env, COMPANION_PLATFORM: 'android' } });
if (build.status !== 0) process.exit(build.status ?? 1);
if (process.argv.includes('--assets-only')) process.exit(0);
if (testing) {
  const adb = buildEnv.ANDROID_HOME ? path.join(buildEnv.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';
  const devices = spawnSync(adb, ['devices'], { encoding: 'utf8', env: buildEnv });
  if (devices.status !== 0) throw new Error('Android SDK platform-tools are required.');
  const online = devices.stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(([, state]) => state === 'device').map(([id]) => id);
  if (!online.length || online.some(id => !id.startsWith('emulator-'))) throw new Error('Native checks require a running emulator and no connected physical Android devices.');
}
const tasks = testing ? ['connectedVerificationAndroidTest'] : release ? ['assembleRelease', 'bundleRelease', 'lintRelease', '-PcompanionSignedRelease=true'] : ['assembleDebug'];
const result = spawnSync(path.join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), tasks, { cwd: android, stdio: 'inherit', env: buildEnv });
process.exit(result.status ?? 1);
