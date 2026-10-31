import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Requires Xcode, an iOS 26+ simulator runtime, and Ruby's xcodeproj gem.
// Real ActivityKit lifecycle + SwiftUI widget; no pairing or live provider.
const root = fileURLToPath(new URL('../..', import.meta.url));
const work = process.env.LIVE_ACTIVITY_ARTIFACTS || mkdtempSync(path.join(tmpdir(), 'korus-live-activity-'));
mkdirSync(work, { recursive: true });
const resultBundle = path.join(work, `results-${Date.now()}.xcresult`);
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const ruby = `
require 'xcodeproj'
root, work = ARGV
project = Xcodeproj::Project.new(File.join(work, 'Activity.xcodeproj'))
app = project.new_target(:application, 'ActivityFixture', :ios, '26.0')
tests = project.new_target(:ui_test_bundle, 'ActivityTests', :ios, '26.0')
tests.add_dependency(app)
['mobile/ios/Shared/WorkActivityAttributes.swift', 'mobile/ios/Shared/WorkActivityViews.swift', 'mobile/ios/Sources/Activities/WorkLiveActivities.swift', 'mobile/ios/Tests/LiveActivities/LiveActivityFixture.swift'].each do |file|
  app.add_file_references([project.main_group.new_file(File.join(root, file))])
end
tests.add_file_references([project.main_group.new_file(File.join(root, 'mobile/ios/Tests/LiveActivities/LiveActivityUITests.swift'))])
vault = project.new_target(:unit_test_bundle, 'VaultTests', :ios, '26.0')
vault.add_dependency(app)
['mobile/ios/Sources/Engine/Keychain.swift', 'mobile/ios/Tests/Vault/KeychainTests.swift'].each do |file|
  vault.add_file_references([project.main_group.new_file(File.join(root, file))])
end
vault.build_configurations.each do |c|
  c.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.korus.vaulttests', 'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0', 'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/ActivityFixture.app/ActivityFixture',
    'BUNDLE_LOADER' => '$(TEST_HOST)', 'CODE_SIGN_IDENTITY' => '-', 'CODE_SIGNING_ALLOWED' => 'YES'})
end
widget = project.new_target(:app_extension, 'WorkActivity', :ios, '26.0')
['mobile/ios/Shared/WorkActivityAttributes.swift', 'mobile/ios/Shared/WorkActivityViews.swift', 'mobile/ios/LiveActivity/WorkActivityWidget.swift'].each do |file|
  widget.add_file_references([project.main_group.new_file(File.join(root, file))])
end
[app, widget].each do |target|
  ['mobile/ios/Assets.xcassets'].each do |file|
    target.resources_build_phase.add_file_reference(project.main_group.new_file(File.join(root, file)))
  end
end
app.add_dependency(widget)
embed = app.new_copy_files_build_phase('Embed App Extensions'); embed.dst_subfolder_spec = '13'
embed.add_file_reference(widget.product_reference).settings = {'ATTRIBUTES' => ['RemoveHeadersOnCopy']}
widget.build_configurations.each do |c|
  c.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.korus.activityfixture.activity', 'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_FILE' => File.join(root, 'mobile/ios/LiveActivity/Info.plist'), 'SWIFT_VERSION' => '5.0', 'CURRENT_PROJECT_VERSION' => '1', 'MARKETING_VERSION' => '1.0', 'COMPANION_DISPLAY_NAME' => 'Korus', 'TARGETED_DEVICE_FAMILY' => '1', 'CODE_SIGN_IDENTITY' => '-', 'CODE_SIGNING_ALLOWED' => 'YES', 'APPLICATION_EXTENSION_API_ONLY' => 'YES'})
end
app.build_configurations.each { |c| c.build_settings['INFOPLIST_KEY_NSSupportsLiveActivities'] = 'YES' }
Xcodeproj::Plist.write_to_path({'CFBundleURLTypes' => [{'CFBundleURLName' => 'Live Activity', 'CFBundleURLSchemes' => ['companion-activity']}]}, File.join(work, 'FixtureInfo.plist'))
app.build_configurations.each { |c| c.build_settings['INFOPLIST_FILE'] = File.join(work, 'FixtureInfo.plist') }
[app, tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings.merge!({'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.korus.' + target.name.downcase,
      'GENERATE_INFOPLIST_FILE' => 'YES', 'SWIFT_VERSION' => '5.0', 'CURRENT_PROJECT_VERSION' => '1', 'MARKETING_VERSION' => '1.0', 'COMPANION_DISPLAY_NAME' => 'Korus', 'TARGETED_DEVICE_FAMILY' => '1',
      'CODE_SIGN_IDENTITY' => '-', 'CODE_SIGNING_ALLOWED' => 'YES', 'INFOPLIST_KEY_CFBundleDisplayName' => 'Korus'})
  end
end
app.build_configurations.each { |c| c.build_settings['INFOPLIST_KEY_UIApplicationSceneManifest_Generation'] = 'YES' }
tests.build_configurations.each { |c| c.build_settings['TEST_TARGET_NAME'] = app.name }
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.add_test_target(vault)
scheme.save_as(project.path, 'Activity')
`;
let device;
try {
  run('ruby', ['-e', ruby, root, work]);
  const runtimes = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json'])).runtimes;
  const runtime = runtimes.filter(r => r.isAvailable && r.name.startsWith('iOS ') && Number(r.version.split('.')[0]) >= 26 && r.supportedDeviceTypes.some(type => type.name.includes('iPhone') && !type.name.includes('Duo')))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!runtime) throw new Error('An iOS 26+ simulator runtime is required.');
  device = run('xcrun', ['simctl', 'create', 'Korus Live Activity Tests', runtime.supportedDeviceTypes.find(type => type.name.includes('iPhone') && !type.name.includes('Duo')).identifier, runtime.identifier]);
  run('xcrun', ['simctl', 'boot', device]);
  run('xcrun', ['simctl', 'bootstatus', device, '-b']);
  console.log(`Native Live Activity evidence: ${resultBundle}`);
  const result = spawnSync('xcodebuild', ['test', '-project', path.join(work, 'Activity.xcodeproj'), '-scheme', 'Activity', '-configuration', 'Release',
    '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', path.join(work, 'Build'),
    '-resultBundlePath', resultBundle, '-parallel-testing-enabled', 'NO', 'ONLY_ACTIVE_ARCH=YES', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  if (device) {
    spawnSync('xcrun', ['simctl', 'shutdown', device], { stdio: 'ignore' });
    spawnSync('xcrun', ['simctl', 'delete', device], { stdio: 'ignore' });
  }
}
