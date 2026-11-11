import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

const folders = {
  '@korus-dev/codex-sdk': 'codex-sdk',
  '@korus-dev/multi-agent-sdk': 'multi-agent-sdk',
  '@korus-dev/agent-ui-sdk': 'agent-ui-sdk',
};
const dependencies = {
  '@korus-dev/codex-sdk': [],
  '@korus-dev/multi-agent-sdk': ['@korus-dev/codex-sdk'],
  '@korus-dev/agent-ui-sdk': ['@korus-dev/multi-agent-sdk'],
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Development tooling only: runtime packages never inspect SDK source settings. */
export function sdkSources(projectRoot, environment = process.env, requested) {
  let dotenv = {};
  try { dotenv = parseEnv(fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const enabled = (environment.SDK_LOCAL_SOURCE ?? dotenv.SDK_LOCAL_SOURCE) === '1';
  const root = path.resolve(projectRoot, environment.SDK_SOURCE_ROOT ?? dotenv.SDK_SOURCE_ROOT ?? '..');
  const own = readJson(path.join(projectRoot, 'package.json')).name;
  const selected = new Map();
  if (folders[own]) selected.set(own, projectRoot);
  const foreign = requested ?? (folders[own] ? dependencies[own] : Object.keys(folders));
  const include = name => {
    if (selected.has(name)) return;
    const folder = path.join(root, folders[name]);
    const file = path.join(folder, 'package.json');
    if (!fs.existsSync(file)) throw new Error(`SDK_LOCAL_SOURCE requires ${name} at ${folder}. Set SDK_SOURCE_ROOT to the directory containing the SDK repositories.`);
    const metadata = readJson(file);
    if (metadata.name !== name) throw new Error(`Expected ${name} at ${folder}, found ${metadata.name}.`);
    selected.set(name, folder);
    for (const dependency of dependencies[name]) include(dependency);
  };
  if (enabled) for (const name of foreign) include(name);
  const aliases = [], paths = {}, typePaths = {};
  for (const [name, directory] of selected) {
    const metadata = readJson(path.join(directory, 'package.json'));
    if (metadata.exports) {
      for (const [entry, definition] of Object.entries(metadata.exports ?? {})) {
        const target = typeof definition === 'string' ? definition : definition.import ?? definition.default ?? definition.types;
        if (!target?.startsWith('./dist/')) continue;
        const specifier = name + (entry === '.' ? '' : entry.slice(1));
        let source = target.replace(/^\.\/dist\//, 'src/').replace(/\.(d\.ts|js)$/, '');
        if (name === '@korus-dev/agent-ui-sdk' && source === 'src/vue/index') source = 'src/vue/entry';
        if (name === '@korus-dev/agent-ui-sdk' && entry === './styles.css') source = 'src/vue/styles.css';
        let replacement = path.resolve(directory, source);
        if (!source.includes('*') && !source.endsWith('.css')) {
          if (fs.existsSync(replacement + '.ts')) replacement += '.ts';
          else if (fs.existsSync(replacement + '.vue')) replacement += '.vue';
          else throw new Error(`Missing local SDK source for ${specifier}: ${replacement}`);
        }
        aliases.push({ find: new RegExp('^' + specifier.split('*').map(escape).join('(.+)') + '$'), replacement: replacement.replace('*', '$1') });
        paths[specifier] = [replacement];
        if (typeof definition !== 'string' && definition.types) {
          typePaths[specifier] = [directory === projectRoot ? replacement : path.resolve(directory, definition.types)];
        }
      }
    } else {
      const entry = metadata.main;
      if (!entry?.startsWith('./dist/')) throw new Error(`Missing built main entry for ${name}`);
      const source = entry.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
      const replacement = path.resolve(directory, source);
      if (!fs.existsSync(replacement)) throw new Error(`Missing local SDK source for ${name}: ${replacement}`);
      aliases.push({ find: new RegExp('^' + escape(name) + '$'), replacement });
      paths[name] = [replacement];
      typePaths[name] = [directory === projectRoot ? replacement : path.resolve(directory, metadata.types)];
      // Published root forwarders are the public entry inventory; no exports map.
      const candidates = new Set(fs.readdirSync(directory).filter(file => file.endsWith('.js')));
      const excluded = new Set(['dist', 'src', 'tests', 'scripts', 'docs', 'examples', 'assets', 'native', 'samples', 'lab', 'coverage', 'node_modules']);
      for (const published of metadata.files ?? []) {
        const first = published.replace(/^\.\//, '').split('/')[0];
        const base = path.join(directory, first);
        if (first.includes('*') || excluded.has(first) || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
        for (const file of fs.readdirSync(base, { recursive: true })) {
          if (typeof file === 'string' && file.endsWith('.js')) candidates.add(path.join(first, file));
        }
      }
      for (const file of candidates) {
        const target = /export\s+\*\s+from\s+['"]([^'"]+)['"]/.exec(fs.readFileSync(path.join(directory, file), 'utf8'))?.[1];
        if (!target) continue;
        const built = path.resolve(directory, path.dirname(file), target);
        const relative = path.relative(path.join(directory, 'dist'), built);
        if (relative.startsWith('..')) continue;
        const live = path.resolve(directory, 'src', relative.replace(/\.js$/, '.ts'));
        if (!fs.existsSync(live)) throw new Error(`Missing local source for ${name}/${file}: ${live}`);
        const specifier = `${name}/${file.replaceAll(path.sep, '/')}`;
        aliases.push({ find: new RegExp('^' + escape(specifier) + '$'), replacement: live });
        paths[specifier] = [live];
        typePaths[specifier] = [directory === projectRoot ? live : path.join(directory, file.replace(/\.js$/, '.d.ts'))];
      }
      if (name === '@korus-dev/agent-ui-sdk') {
        const css = path.resolve(directory, 'src/vue/styles.css');
        aliases.push({ find: /^@korus-dev\/agent-ui-sdk\/styles\.css$/, replacement: css });
        paths[`${name}/styles.css`] = [css];
      }
    }
  }
  aliases.sort((a, b) => b.find.source.length - a.find.source.length);
  return { enabled, root, aliases, paths, typePaths };
}

/** Local runtime uses source; compilers use local declaration boundaries. */
export function sourceTypecheck(projectRoot, args, environment = process.env) {
  const config = sdkSources(projectRoot, environment);
  if (!config.enabled) return { args, cleanup() {} };
  const projectArg = args.findIndex(arg => arg === '-p' || arg === '--project');
  const file = path.resolve(projectArg < 0 ? process.cwd() : args[projectArg + 1], projectArg < 0 ? 'tsconfig.json' : '');
  const actual = fs.statSync(file).isDirectory() ? path.join(file, 'tsconfig.json') : file;
  const require = createRequire(path.join(projectRoot, 'package.json'));
  const ts = require('typescript');
  const parsed = ts.getParsedCommandLineOfConfigFile(actual, {}, ts.sys);
  if (!parsed) throw new Error(`Could not read ${actual}`);
  const pathsBase = parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(actual);
  const existing = Object.fromEntries(Object.entries(parsed.options.paths ?? {}).map(([key, values]) => [key, values.map(value => path.resolve(pathsBase, value))]));
  // Match Vite's Vue dedupe across sibling checkouts. Different Vue versions
  // otherwise give Ref and component types distinct identities.
  const vueTypes = ts.resolveModuleName('vue', actual, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
  const sharedTypes = vueTypes ? { vue: [vueTypes] } : {};
  const temporary = fs.mkdtempSync(path.join(projectRoot, '.sdk-typecheck-'));
  const target = path.join(temporary, 'tsconfig.json');
  fs.writeFileSync(target, JSON.stringify({ extends: actual, compilerOptions: { paths: { ...existing, ...config.typePaths, ...sharedTypes } } }));
  const forwarded = [...args];
  if (projectArg < 0) forwarded.push('--project', target); else forwarded[projectArg + 1] = target;
  return { args: forwarded, cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }) };
}
