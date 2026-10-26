import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const product = JSON.parse(await readFile(path.join(rootDirectory, 'core/src/product.json'), 'utf8'));
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const execute = (command, args) => execFileSync(command, args, { stdio: 'pipe' });
const xml = value => value.replace(/[<>&"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[character]));

/** An alias belongs to exactly one worktree/profile, never the installed product scheme. */
export async function createDevelopmentLinkTarget({ root = rootDirectory, home, directory, executable, appPath, platform = process.platform, run = execute, environment = {}, electronArgs = [] }) {
  if (!home || !path.isAbsolute(home)) throw new Error('An absolute isolated development profile is required.');
  root = path.resolve(root); home = path.resolve(home); directory ??= path.join(home, 'native-url');
  const suffix = createHash('sha256').update(JSON.stringify([root, home])).digest('hex').slice(0, 12);
  const scheme = `${product.protocolScheme}-dev-${suffix}`; const id = `${product.appId}.development.${suffix}`;
  executable ??= createRequire(import.meta.url)('electron'); appPath ??= path.join(root, 'electron');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const launcher = path.join(directory, 'launch.mjs');
  const configuration = path.join(directory, 'target.json');
  const config = { executable, appPath, home, scheme, electronArgs, environment: { ...environment,
    NODE_ENV: 'development', APP_HOME: home, APP_DEV_PROTOCOL_SCHEME: scheme,
    APP_BACKEND_MODE: 'bundled', APP_BACKEND_SOCKET: path.join(home, 'daemon.sock'), APP_BACKEND_COMMAND: process.execPath, APP_BACKEND_ARGS: `${path.join(root, 'backend/dist/daemon.mjs')},--stdio`, APP_BACKEND_WATCH_FILE: '',
    APP_ASSETS_PATH: path.join(root, 'electron/assets'), CODEX_APP_SDK_ASSETS_PATH: path.join(root, 'node_modules/@codex-app-sdk/backend/assets'),
  } };
  await writeFile(configuration, JSON.stringify(config), { mode: 0o600 });
  await writeFile(launcher, `import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const target=JSON.parse(readFileSync(${JSON.stringify(configuration)},'utf8'));
const url=process.argv.slice(2).find(value=>value.startsWith(target.scheme+'://'));
if(process.argv.length>2&&!url)process.exit(1);
const env={...process.env,...target.environment};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(target.executable,[target.appPath,...target.electronArgs,'--user-data-dir='+target.home+'/electron',...(url?[url]:[])],{env,detached:true,stdio:'ignore'});
child.on('error',()=>{process.exitCode=1});
if(process.env.APP_DEV_LINK_TEST_WAIT!=='1')child.unref();
`, { mode: 0o600 });
  let nativePath;
  if (platform === 'darwin') {
    nativePath = path.join(homedir(), 'Applications', `${product.name} Development Links ${suffix}.app`);
    const macos = path.join(nativePath, 'Contents/MacOS'); await mkdir(macos, { recursive: true });
    const swift = path.join(directory, 'launcher.swift');
    await writeFile(swift, `import AppKit
final class Delegate: NSObject, NSApplicationDelegate {
  var delivered = false
  func launch(_ urls: [URL]) {
    let values = urls.isEmpty ? [""] : urls.map { $0.absoluteString }
    for value in values {
      let child = Process(); child.executableURL = URL(fileURLWithPath: ${JSON.stringify(process.execPath)})
      child.arguments = [${JSON.stringify(launcher)}] + (value.isEmpty ? [] : [value])
      child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
      do { try child.run(); child.waitUntilExit() } catch { }
    }
    NSApplication.shared.terminate(nil)
  }
  func application(_ application: NSApplication, open urls: [URL]) { delivered = true; launch(urls) }
  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if !self.delivered { self.launch([]) } }
  }
}
let app = NSApplication.shared; let delegate = Delegate(); app.delegate = delegate
app.setActivationPolicy(.prohibited); app.run()
`);
    run('xcrun', ['swiftc', swift, '-o', path.join(macos, 'DevelopmentLinks')]);
    await writeFile(path.join(nativePath, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${xml(id)}</string><key>CFBundleExecutable</key><string>DevelopmentLinks</string><key>CFBundleName</key><string>${xml(product.name)} Development Links</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>${xml(id)}</string><key>CFBundleURLSchemes</key><array><string>${xml(scheme)}</string></array></dict></array></dict></plist>`);
    run('codesign', ['--force', '--sign', '-', nativePath]); run(lsregister, ['-f', nativePath]);
  } else if (platform === 'win32') {
    nativePath = `HKCU\\Software\\Classes\\${scheme}`;
    run('reg.exe', ['add', nativePath, '/ve', '/d', `${product.name} development link`, '/f']);
    run('reg.exe', ['add', nativePath, '/v', 'URL Protocol', '/d', '', '/f']);
    run('reg.exe', ['add', `${nativePath}\\shell\\open\\command`, '/ve', '/d', `"${process.execPath}" "${launcher}" "%1"`, '/f']);
  } else if (platform === 'linux') {
    const dataHome = environment.XDG_DATA_HOME || process.env.XDG_DATA_HOME || path.join(process.env.HOME, '.local/share');
    nativePath = path.join(dataHome, 'applications', `${id}.desktop`); await mkdir(path.dirname(nativePath), { recursive: true });
    const quote = value => `"${value.replace(/[%\\"`$]/g, character => character === '%' ? '%%' : '\\\\' + character)}"`;
    await writeFile(nativePath, `[Desktop Entry]\nType=Application\nName=${product.name} Development Links\nExec=${quote(process.execPath)} ${quote(launcher)} %u\nNoDisplay=true\nTerminal=false\nMimeType=x-scheme-handler/${scheme};\n`);
    run('xdg-mime', ['default', path.basename(nativePath), `x-scheme-handler/${scheme}`]);
  } else throw new Error('Unsupported desktop platform.');
  const target = { scheme, launcher, nativePath, platform }; await writeFile(path.join(directory, 'registration.json'), JSON.stringify(target), { mode: 0o600 });
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]; const homeIndex = process.argv.indexOf('--home'); const home = process.argv[homeIndex + 1];
  if (homeIndex < 0 || !home || !path.isAbsolute(home)) throw new Error('Usage: node scripts/dev-link.mjs register|open|unregister --home /absolute/isolated/profile. Open reads a product link from stdin.');
  const directory = path.join(home, 'native-url');
  if (command === 'register') {
    const environment = Object.fromEntries(['APP_COMPANION_RELAY_URL', 'APP_COMPANION_RELAY_PEER_ID'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const target = await createDevelopmentLinkTarget({ home, environment }); console.log(JSON.stringify({ scheme: target.scheme, target: target.nativePath }));
  } else if (command === 'open') {
    const target = JSON.parse(await readFile(path.join(directory, 'registration.json'), 'utf8'));
    let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 2049) throw new Error('Invalid share link.'); }
    const link = input.trim(); if (!link.startsWith(`${product.protocolScheme}://`) || link.length > 2048) throw new Error('Invalid share link.');
    const url = `${target.scheme}:${link.slice(product.protocolScheme.length + 1)}`;
    const child = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open', process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], { stdio: 'ignore' });
    child.on('error', () => { console.error('Native URL delivery failed.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } else if (command === 'unregister') {
    const target = JSON.parse(await readFile(path.join(directory, 'registration.json'), 'utf8'));
    if (target.platform === 'darwin') execute(lsregister, ['-u', target.nativePath]);
    else if (target.platform === 'win32') execute('reg.exe', ['delete', target.nativePath, '/f']);
    else await rm(target.nativePath, { force: true });
    if (target.platform === 'darwin') await rm(target.nativePath, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  } else throw new Error('Expected register, open or unregister.');
}
