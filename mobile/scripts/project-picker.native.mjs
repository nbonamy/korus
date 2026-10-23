import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Requires Xcode, an iOS 26+ simulator runtime, and Ruby's xcodeproj gem.
// Real SwiftUI picker + native XCTest gestures; no pairing or live provider.
const root = fileURLToPath(new URL('../..', import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'korus-project-picker-'));
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const ruby = `
require 'xcodeproj'
root, work = ARGV
project = Xcodeproj::Project.new(File.join(work, 'Picker.xcodeproj'))
app = project.new_target(:application, 'PickerFixture', :ios, '26.0')
tests = project.new_target(:ui_test_bundle, 'PickerTests', :ios, '26.0')
tests.add_dependency(app)
['Views/NewProjectSheet.swift', 'Views/RenameAgentSheet.swift', 'Views/SheetStyle.swift'].each do |file|
  app.add_file_references([project.main_group.new_file(File.join(root, 'mobile/ios/Sources', file))])
end
app.add_file_references([project.main_group.new_file(File.join(root, 'mobile/ios/Tests/ProjectAcquisition/ProjectPickerFixture.swift'))])
tests.add_file_references([project.main_group.new_file(File.join(root, 'mobile/ios/Tests/ProjectAcquisition/ProjectPickerUITests.swift'))])
[app, tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.korus.' + target.name.downcase,
      'GENERATE_INFOPLIST_FILE' => 'YES', 'SWIFT_VERSION' => '5.0', 'TARGETED_DEVICE_FAMILY' => '1',
      'CODE_SIGN_IDENTITY' => '-', 'CODE_SIGNING_ALLOWED' => 'YES'})
  end
end
app.build_configurations.each { |c| c.build_settings['INFOPLIST_KEY_UIApplicationSceneManifest_Generation'] = 'YES' }
tests.build_configurations.each { |c| c.build_settings['TEST_TARGET_NAME'] = app.name }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.save_as(project.path, 'Picker')
`;
let device;
try {
  run('ruby', ['-e', ruby, root, work]);
  const runtimes = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes;
  const runtime = runtimes.filter(r => r.isAvailable && r.name.startsWith('iOS ') && Number(r.version.split('.')[0]) >= 26)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error('An iOS 26+ simulator runtime is required.');
  device = run('xcrun', ['simctl', 'create', 'Korus Project Picker Tests', 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier]);
  run('xcrun', ['simctl', 'boot', device]);
  run('xcrun', ['simctl', 'bootstatus', device, '-b']);
  console.log(`Native picker evidence: ${work}/results.xcresult`);
  const result = spawnSync('xcodebuild', ['test', '-project', path.join(work, 'Picker.xcodeproj'), '-scheme', 'Picker', '-configuration', 'Release',
    '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', path.join(work, 'Build'),
    '-resultBundlePath', path.join(work, 'results.xcresult'), '-parallel-testing-enabled', 'NO'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  if (device) {
    spawnSync('xcrun', ['simctl', 'shutdown', device], { stdio: 'ignore' });
    spawnSync('xcrun', ['simctl', 'delete', device], { stdio: 'ignore' });
  }
}
