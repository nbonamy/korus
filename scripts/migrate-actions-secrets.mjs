import { spawnSync } from 'node:child_process';

const names = [
  'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APP_COMPANION_RELAY_PEER_ID',
  'APP_COMPANION_RELAY_URL', 'APP_GITHUB_CLIENT_ID', 'APP_GITLAB_CLIENT_ID',
  'APP_LINEAR_CLIENT_ID', 'APP_TELEMETRY_ENDPOINT', 'BUILD_CERTIFICATE_BASE64',
  'BUILD_CERTIFICATE_PASSWORD', 'DESKTOP_RELEASE_TOKEN', 'IDENTITY_DARWIN_CODE', 'TEST_SHARED_LINK',
];
const secrets = JSON.parse(process.env.SOURCE_SECRETS ?? '{}');
const missing = names.filter(name => typeof secrets[name] !== 'string' || !secrets[name]);
if (!process.env.GH_TOKEN || missing.length) {
  console.error(`Missing migration token or source secrets: ${missing.join(', ')}`);
  process.exit(1);
}
const repo = 'Korus-Dev/korus';
const { SOURCE_SECRETS: _sourceSecrets, ...childEnv } = process.env;
for (const name of names) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: secrets[name], encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'], env: childEnv,
  });
  if (result.status !== 0) {
    console.error(`Failed to transfer ${name}; exit status ${result.status ?? 'unavailable'}.`);
    process.exit(1);
  }
  console.log(`Transferred ${name}`);
}
