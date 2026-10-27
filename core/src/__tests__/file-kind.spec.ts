import { describe, expect, it } from 'vitest';
import { addFileToKindStats, classifyFile, emptyKindStats, mergeKindStats } from '../file-kind';


describe('classifyFile', () => {
  it.each([
    // TypeScript / JavaScript
    'src/app.test.ts', 'src/app.spec.tsx', 'src/__tests__/app.ts', 'web/e2e/login.spec.ts', 'lib/util.test.js', 'packages/a/tests/helper.mjs', 'cypress/e2e/home.cy.ts',
    // Python
    'tests/test_api.py', 'pkg/test_models.py', 'pkg/models_test.py', 'conftest.py', 'pkg/tests/conftest.py',
    // Java / Kotlin / Scala / C# / Swift / PHP
    'src/test/java/com/acme/OrderTest.java', 'src/main/java/com/acme/OrderTests.java', 'src/it/OrderIT.java', 'app/src/test/kotlin/UserSpec.kt', 'core/PaymentSpec.scala',
    'Billing.Tests/InvoiceTests.cs', 'Sources/AppTests/ModelTests.swift', 'tests/Unit/UserTest.php', 'src/TestUtils.java',
    // Go / Rust / Ruby / Elixir / Dart / C++ / Haskell / Lua
    'pkg/server/server_test.go', 'tests/integration.rs', 'crates/x/tests/api.rs', 'spec/models/user_spec.rb', 'test/models/user_test.rb', 'test/foo_test.exs',
    'test/widget_test.dart', 'src/foo_test.cc', 'src/foo_unittest.cpp', 'test/Spec.hs', 'spec/foo_spec.lua',
    // Fixtures and snapshots
    'src/__snapshots__/app.test.ts.snap', 'internal/testdata/golden.json', 'tests/fixtures/users.json', 'src/__mocks__/api.ts', 'features/login.feature',
  ])('treats %s as a test', path => { expect(classifyFile(path)).toBe('test'); });

  it.each([
    'README.md', 'docs/guide/install.md', 'CHANGELOG.md', 'LICENSE', 'CONTRIBUTING', 'website/docs/index.mdx', 'docs/api.rst', 'guide.adoc', 'docs/architecture.png',
    'src/README.md', 'tests/README.md', 'doc/overview.txt', 'NOTICE', 'docs/conf.py',
  ])('treats %s as documentation', path => { expect(classifyFile(path)).toBe('docs'); });

  it.each([
    'src/app.ts', 'src/App.tsx', 'lib/index.js', 'ui/Card.vue', 'pkg/api.py', 'src/main/java/com/acme/Order.java', 'cmd/server/main.go', 'src/lib.rs', 'app/models/user.rb',
    'lib/foo.ex', 'lib/main.dart', 'src/foo.cc', 'include/foo.hpp', 'Sources/App/Model.swift', 'app/Http/User.php', 'src/Billing/Invoice.cs', 'scripts/deploy.sh', 'db/schema.sql',
    'styles/app.scss', 'public/index.html', 'proto/api.proto', 'src/Contest.java', 'src/latest/api.ts', 'src/testing_utils_not.ts',
  ])('treats %s as code', path => { expect(classifyFile(path)).toBe('code'); });

  it.each([
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'yarn.lock', 'tsconfig.json', '.github/workflows/ci.yml', 'Dockerfile', 'Makefile',
    'assets/logo.svg', 'public/photo.png', 'config/app.toml', '.gitignore', 'dist/bundle.js', 'node_modules/x/index.js', 'vendor/lib/a.go', 'src/app.min.js', 'jest.config.ts', 'data/export.csv',
  ])('treats %s as other', path => { expect(classifyFile(path)).toBe('other'); });

  it('reads Windows separators, renames and quoted paths', () => {
    expect(classifyFile('src\\__tests__\\app.ts')).toBe('test');
    expect(classifyFile('src/{old => new}/app.test.ts')).toBe('test');
    expect(classifyFile('src/old.ts => src/new.ts')).toBe('code');
    expect(classifyFile('"src/with space/app.ts"')).toBe('code');
  });

  it('prefers a documentation extension over a test directory and a test name over a docs directory', () => {
    expect(classifyFile('tests/NOTES.md')).toBe('docs');
    expect(classifyFile('docs/examples/app.test.ts')).toBe('test');
  });
});

describe('kind stats', () => {
  it('adds files into their kind and merges two breakdowns', () => {
    const stats = emptyKindStats();
    addFileToKindStats(stats, 'src/app.ts', 10, 2);
    addFileToKindStats(stats, 'src/app.test.ts', 5, 0);
    addFileToKindStats(stats, 'README.md', 1, 1);
    expect(stats).toStrictEqual({
      code: { addedLines: 10, removedLines: 2, changedFiles: 1 },
      test: { addedLines: 5, removedLines: 0, changedFiles: 1 },
      docs: { addedLines: 1, removedLines: 1, changedFiles: 1 },
      other: { addedLines: 0, removedLines: 0, changedFiles: 0 },
    });
    const merged = mergeKindStats(stats, stats);
    expect(merged.code).toStrictEqual({ addedLines: 20, removedLines: 4, changedFiles: 2 });
    expect(stats.code.addedLines).toBe(10);
  });
});
