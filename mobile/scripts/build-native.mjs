import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
const allowed = ['ios-simulator', 'android-debug', 'android-release'];
if (!allowed.includes(target)) throw new Error(`Choose ${allowed.join(', ')}.`);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('npm', ['run', 'sync']);
if (target === 'ios-simulator') {
  if (process.platform !== 'darwin') throw new Error('The iOS simulator build requires macOS and Xcode.');
  run('xcodebuild', ['-project', path.join(root, 'ios/App/App.xcodeproj'), '-scheme', 'App', '-configuration', 'Release', '-sdk', 'iphonesimulator',
    '-derivedDataPath', path.join(root, '.native-build/ios-release'), 'CODE_SIGN_IDENTITY=-', 'build']);
} else {
  run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['--no-daemon', target === 'android-debug' ? 'assembleDebug' : 'assembleRelease'], path.join(root, 'android'));
}
