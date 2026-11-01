import product from '../core/src/product.json' with { type: 'json' };
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  githubAccessTokenFromFile,
  githubLoginFromToolResult,
  providerTokensFilePath,
  redactGitHubCredentials,
  verifyGitHubMcpToken,
} from './verify-github-mcp-token.mjs';

test(`resolves the token file from the ${product.name} home`, () => {
  assert.equal(
    providerTokensFilePath({ APP_HOME: ' /tmp/app-home ' }, '/Users/test'),
    '/tmp/app-home/provider-tokens.json',
  );
  assert.equal(providerTokensFilePath({ KORUS_HOME: ' /tmp/alias ' }, '/Users/test'), '/tmp/alias/provider-tokens.json');
  assert.equal(providerTokensFilePath({ APP_HOME: ' ', KORUS_HOME: '/tmp/alias' }, '/Users/test'), '/tmp/alias/provider-tokens.json');
  assert.equal(providerTokensFilePath({ APP_HOME: '/tmp/primary', KORUS_HOME: '/tmp/alias' }, '/Users/test'), '/tmp/primary/provider-tokens.json');
  assert.equal(providerTokensFilePath({}, '/Users/test'), `/Users/test/${product.homeDirectory}/provider-tokens.json`);
});

test('reads only the connected GitHub access token', () => {
  assert.equal(githubAccessTokenFromFile(JSON.stringify({
    tokens: { github: { accessToken: ' ghu_access ' } },
  })), 'ghu_access');
  assert.throws(() => githubAccessTokenFromFile('{}'), /No connected GitHub access token/);
  assert.throws(() => githubAccessTokenFromFile('{'), /not valid JSON/);
});

test('extracts only the GitHub login from the tool result', () => {
  assert.equal(githubLoginFromToolResult({
    content: [{ type: 'text', text: JSON.stringify({ login: 'octocat', email: 'private@example.com' }) }],
  }), 'octocat');
  assert.equal(githubLoginFromToolResult({ content: [{ type: 'text', text: 'not json' }] }), null);
});

test('redacts GitHub credentials from failures and still closes', async () => {
  let closed = false;
  await assert.rejects(() => verifyGitHubMcpToken({
    readTextFile: async () => JSON.stringify({ tokens: { github: { accessToken: 'ghu_supersecret' } } }),
    createConnection: () => ({
      connect: async () => undefined,
      callGetMe: async () => { throw new Error('rejected ghu_supersecret'); },
      close: async () => { closed = true; },
    }),
  }), (error) => {
    assert.equal(error.message, 'rejected [redacted]');
    return true;
  });
  assert.equal(closed, true);
  assert.equal(redactGitHubCredentials('tokens gho_12345678 and github_pat_abcdefgh'), 'tokens [redacted] and [redacted]');
});
