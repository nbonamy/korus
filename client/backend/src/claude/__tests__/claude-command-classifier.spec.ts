import { describe, expect, it } from 'vitest';
import { classifyShellCommand } from '../claude-command-classifier';

describe('Claude shell command classifier', () => {
  it.each([
    ['cat src/app.ts', ['src/app.ts']],
    ['cat "docs/my file.md" README.md', ['docs/my file.md', 'README.md']],
    ['head -n 20 src/app.ts', ['src/app.ts']],
    ['head -20 src/app.ts', ['src/app.ts']],
    ['tail -n +5 log.txt', ['log.txt']],
    ["sed -n '10,40p' src/app.ts", ['src/app.ts']],
    ["sed -n '5p' a.ts", ['a.ts']],
  ])('reads files: %s', (command, files) => {
    expect(classifyShellCommand(command)).toStrictEqual({ action: 'read', files });
  });

  it.each([
    ['ls', ['.']],
    ['ls -la', ['.']],
    ['ls -la src docs', ['src', 'docs']],
    ['tree -L 2 src', ['src']],
    ['find src -type f', ['src']],
    ['find . -maxdepth 2', ['.']],
  ])('lists paths: %s', (command, paths) => {
    expect(classifyShellCommand(command)).toStrictEqual({ action: 'list', paths });
  });

  it.each([
    ['rg useState src', { pattern: 'useState', paths: ['src'] }],
    ['rg -n "use state" src/app src/lib', { pattern: 'use state', paths: ['src/app', 'src/lib'] }],
    ['rg -i -g "*.ts" foo', { pattern: 'foo', paths: [] }],
    ['rg --glob "*.ts" foo src', { pattern: 'foo', paths: ['src'] }],
    ['grep -rn TODO .', { pattern: 'TODO', paths: ['.'] }],
    ['grep -e foo -e bar src', { pattern: 'foo', paths: ['src'] }],
    ['grep -A3 foo file.txt', { pattern: 'foo', paths: ['file.txt'] }],
    ['grep -A 3 foo file.txt', { pattern: 'foo', paths: ['file.txt'] }],
    ['find src -name "*.ts"', { pattern: '*.ts', paths: ['src'] }],
  ])('searches: %s', (command, expected) => {
    expect(classifyShellCommand(command)).toStrictEqual({ action: 'search', ...expected });
  });

  it.each([
    'npm test',
    'cat src/app.ts | head',
    'cat a.ts && cat b.ts',
    'cat a.ts; rm b.ts',
    'cat a.ts > b.ts',
    'cat $HOME/file',
    'cat `which node`',
    'cat "$(pwd)/file"',
    'cat src/*.ts',
    'cat',
    'cat -',
    "sed -i 's/a/b/' file.ts",
    "sed -n 'w out.txt' file.ts",
    "sed 's/a/b/' file.ts",
    'find . -name "*.log" -delete',
    'find . -exec rm {} ;',
    'rg --unknown-flag foo',
    'rg',
    'grep',
    'ls "unterminated',
    'tree -o out.txt src',
    'ls -I vendor',
    'cd src && ls',
    'ls\nrm -rf x',
    '',
  ])('leaves other commands as plain runs: %j', (command) => {
    expect(classifyShellCommand(command)).toBeNull();
  });
});
