import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ios = path.join(root, 'mobile/ios');
const scratch = mkdtempSync(path.join(tmpdir(), 'korus-transcript-native-'));
const app = path.join(scratch, 'TranscriptTests.app');
const identifier = 'dev.korus.transcript-tests';
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let simulator;
let launched;
try {
  assert.equal(process.platform, 'darwin', 'Native transcript tests require Xcode on macOS.');
  if (!existsSync(path.join(ios, 'Web/transcript.html'))) throw new Error('Run npm run build:web -w @workspace/mobile first.');
  mkdirSync(app);
  cpSync(path.join(ios, 'Web'), path.join(app, 'Web'), { recursive: true });
  cpSync(path.join(root, 'electron/assets/icon.png'), path.join(app, 'icon.png'));
  writeFileSync(path.join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleName</key><string>Transcript tests</string>
    <key>CFBundleExecutable</key><string>TranscriptTests</string><key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSRequiresIPhoneOS</key><true/><key>UIDeviceFamily</key><array><integer>1</integer></array><key>UILaunchScreen</key><dict/>
    <key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/><key>UISceneConfigurations</key><dict/></dict>
    </dict></plist>`);
  const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  const sources = ['Tests/TranscriptHost/TranscriptHostProbe.swift', 'Sources/Engine/TranscriptHost.swift', 'Sources/Engine/WebAssets.swift',
    'Sources/Conversation/TranscriptRenderQueue.swift', 'Sources/Conversation/ConversationLoadingState.swift', 'Sources/Conversation/ImagePreview.swift', 'Sources/Conversation/ExternalLink.swift',
    'Sources/Composer/ComposerCompletion.swift', 'Sources/Composer/ComposerChipText.swift', 'Sources/Views/ComposerEditor.swift',
    'Sources/Lock/AppLock.swift', 'Sources/Views/LockView.swift', 'Sources/Views/StartupView.swift', 'Sources/Conversation/StreamBackgroundExecution.swift'];
  run('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios26.0-simulator`, '-sdk', sdk,
    '-o', path.join(app, 'TranscriptTests'), ...sources.map(source => path.join(ios, source))]);
  run('codesign', ['--force', '--sign', '-', app]);
  const runtimes = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes;
  const runtime = runtimes.filter(value => value.isAvailable && value.name.startsWith('iOS ') && Number(value.version.split('.')[0]) >= 26)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  assert.ok(runtime, 'Install an iOS 26 or newer simulator runtime.');
  simulator = run('xcrun', ['simctl', 'create', 'Korus Transcript Tests', 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier]);
  run('xcrun', ['simctl', 'boot', simulator]);
  console.log('Booting isolated native transcript tests:', simulator);
  run('xcrun', ['simctl', 'bootstatus', simulator, '-b']);
  run('xcrun', ['simctl', 'install', simulator, app]);
  launched = spawn('xcrun', ['simctl', 'launch', '--console-pty', simulator, identifier], { stdio: ['ignore', 'pipe', 'pipe'] });
  launched.stdout.on('data', bytes => {
    for (const line of String(bytes).split('\n')) if (line.includes('TRANSCRIPT_NATIVE')) console.log(line.trim());
  });
  let launchError;
  launched.on('error', error => { launchError = error; });
  const container = run('xcrun', ['simctl', 'get_app_container', simulator, identifier, 'data']);
  const resultPath = path.join(container, 'Documents/transcript-results.json');
  for (let attempt = 0; attempt < 240 && !existsSync(resultPath); attempt++) {
    if (launchError) throw launchError;
    await delay(500);
  }
  assert.ok(existsSync(resultPath), 'Native transcript probe did not complete within 120 seconds.');
  const results = JSON.parse(readFileSync(resultPath, 'utf8'));
  writeFileSync(path.join(scratch, 'results.json'), JSON.stringify(results, null, 2));
  if (process.env.APP_NATIVE_SKIP_SCREENSHOTS !== '1') for (const name of ['lock-locked.png', 'connecting.png']) cpSync(path.join(container, 'Documents', name), path.join(scratch, name));
  assert.ok(results.length >= 12, 'Native probe did not exercise all recovery scenarios.');
  assert.deepEqual(results.filter(result => !result.passed), [], 'Native transcript regressions failed.');
  console.log(`Native transcript checks passed: ${results.length}. Evidence: ${scratch}/results.json`);

  // Exercise the actual app's scene callbacks: an authenticated phone must retain
  // its screen through an ordinary fifteen-second switch to another app and back.
  const resumeApp = path.join(scratch, 'ResumeTests.app');
  const resumeId = 'dev.korus.resumetests';
  mkdirSync(resumeApp);
  cpSync(path.join(root, 'electron/assets/icon.png'), path.join(resumeApp, 'icon.png'));
  writeFileSync(path.join(resumeApp, 'Info.plist'), readFileSync(path.join(app, 'Info.plist'), 'utf8')
    .replaceAll(identifier, resumeId).replaceAll('TranscriptTests', 'ResumeTests'));
  const resumeSources = ['Tests/AppResume/AppResumeProbe.swift', 'Sources/Conversation/StreamBackgroundExecution.swift', 'Sources/CompanionApp.swift', 'Sources/Lock/AppLockWindow.swift', 'Sources/Views/LockView.swift', 'Sources/Views/StartupView.swift'];
  run('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios26.0-simulator`, '-sdk', sdk,
    '-o', path.join(resumeApp, 'ResumeTests'), ...resumeSources.map(source => path.join(ios, source))]);
  run('codesign', ['--force', '--sign', '-', resumeApp]);
  run('xcrun', ['simctl', 'install', simulator, resumeApp]);
  run('xcrun', ['simctl', 'launch', simulator, resumeId]);
  const resumeContainer = run('xcrun', ['simctl', 'get_app_container', simulator, resumeId, 'data']);
  const resumePath = path.join(resumeContainer, 'Documents/resume.json');
  async function resumed(after = 0) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (existsSync(resumePath)) {
        const result = JSON.parse(readFileSync(resumePath, 'utf8'));
        if (result.activations > after) return result;
      }
      await delay(100);
    }
    throw new Error('Native app did not become active within 10 seconds.');
  }
  const initial = await resumed();
  run('xcrun', ['simctl', 'launch', simulator, 'com.apple.Preferences']);
  await delay(15_000);
  run('xcrun', ['simctl', 'launch', simulator, resumeId]);
  const resume = await resumed(initial.activations);
  assert.equal(resume.pid, initial.pid, 'The resume check must keep the original app alive.');
  assert.equal(resume.coverVisibleBeforeForeground, false, 'Brief app switches must not return behind the branded lock cover.');
  assert.equal(resume.coverVisibleOnResume, false, 'An authenticated app must keep its last screen visible.');
  assert.deepEqual(resume.executionEvents, ['acquired'], 'Active streaming must hold one native execution assertion through the switch.');
  writeFileSync(path.join(scratch, 'resume.json'), JSON.stringify(resume, null, 2));
  console.log(`Native fifteen-second resume and background assertion check passed. Evidence: ${scratch}/resume.json`);
} finally {
  if (simulator) {
    for (const args of [['terminate', simulator, identifier], ['shutdown', simulator], ['delete', simulator]]) {
      try { run('xcrun', ['simctl', ...args]); } catch { /* The owned simulator may already have exited. */ }
    }
  }
  launched?.kill();
}
