"""Positive/negative diagnostics through the real Vue checkers and original configs."""
import argparse, json, os, pathlib, re, shutil, subprocess, sys

parser = argparse.ArgumentParser(); parser.add_argument('--repo', choices=['korus', 'sdk'], required=True); parser.add_argument('--output', required=True)
args = parser.parse_args(); root = pathlib.Path.cwd().resolve(); output = pathlib.Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
fixtures = json.loads(pathlib.Path(__file__).with_name('ci-parity-fixtures.json').read_text())
tasks = [('vue', 'vue', 'tsconfig.json'), ('web-client', 'web', 'tsconfig.json'), ('mobile-web', 'mobile/web', 'tsconfig.json')] if args.repo == 'korus' else [('vue', 'packages/vue', 'tsconfig.test.json'), ('compatibility', '', 'tsconfig.json'), ('component-lab', 'samples/component-lab', 'tsconfig.json'), ('basic-electron', 'samples/electron/basic', 'tsconfig.json'), ('spark', 'samples/electron/spark', 'tsconfig.json'), ('relay', 'samples/electron/relay', 'tsconfig.json'), ('basic-web', 'samples/web/basic', 'tsconfig.json')]
results = []; failures = []


def invoke(name, folder, config, phase, fast):
    command = ['node', str(root / 'scripts/ci-typecheck.mjs'), 'vue', '--noEmit', '-p', config, '--pretty', 'false']
    result = subprocess.run(command, cwd=root / folder, env={**os.environ, 'CI_BENCH_FAST': str(int(fast)), 'NODE_OPTIONS': '--max-old-space-size=4096'}, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    label = name + '-' + phase + ('-bridge' if fast else '-stock'); (output / (label + '.log')).write_text(result.stdout)
    diagnostics = []
    for match in re.finditer(r'^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$', result.stdout, re.M):
        file = (root / folder / match[1]).resolve().relative_to(root)
        diagnostics.append([str(file), int(match[2]), int(match[3]), int(match[4])])
    record = {'program': name, 'phase': phase, 'checker': 'bridge' if fast else 'stock', 'exit_code': result.returncode, 'diagnostics': sorted(diagnostics)}
    results.append(record); (output / 'parity-results.json').write_text(json.dumps(results, indent=2)); print(json.dumps(record), flush=True)
    return record


for name, folder, config in tasks:
    project = root / folder; src = 'src/client' if name in ['web-client', 'basic-web'] else 'src'
    directory = project / src / '__vue_checker_benchmark__'
    testroot = project / 'tests' if args.repo == 'sdk' and name != 'basic-web' else project / src / '__tests__'
    testfile = testroot / '__vue_checker_benchmark_test.ts'
    if directory.exists() or testfile.exists(): raise RuntimeError('Refusing to replace an existing fixture')
    directory.mkdir(parents=True); existed = testroot.exists(); testroot.mkdir(parents=True, exist_ok=True)
    try:
        (directory / 'CommonChild.vue').write_text(fixtures['child']); (directory / 'CommonGeneric.vue').write_text(fixtures['generic'])
        for phase, index in [('valid', 0), ('invalid', 1)]:
            for case, values in fixtures['cases'].items(): (directory / ('Probe_' + case + '.vue')).write_text(values[index])
            (directory / 'consumer.ts').write_text("import Child from './CommonChild.vue';\nexport const props: InstanceType<typeof Child>['$props'] = {count: " + ('1' if phase == 'valid' else "'bad'") + '};\n')
            testfile.write_text('export const testAssignment: number = ' + ('1' if phase == 'valid' else "'bad'") + ';\n')
            stock = invoke(name, folder, config, phase, False); bridge = invoke(name, folder, config, phase, True)
            if phase == 'valid' and any(r['exit_code'] != 0 or r['diagnostics'] for r in [stock, bridge]): failures.append(name + ': positive fixture failed')
            if phase == 'invalid' and (stock['exit_code'] == 0 or bridge['exit_code'] == 0 or len(stock['diagnostics']) != 14 or stock['diagnostics'] != bridge['diagnostics']): failures.append(name + ': negative diagnostic mismatch')
    finally:
        shutil.rmtree(directory); testfile.unlink(missing_ok=True)
        if not existed:
            try: testroot.rmdir()
            except OSError: pass
    restored = invoke(name, folder, config, 'restored', True)
    if restored['exit_code'] != 0 or restored['diagnostics']: failures.append(name + ': original program failed after cleanup')
(output / 'parity-summary.json').write_text(json.dumps({'programs': len(tasks), 'expected_deliberate_diagnostics': 14 * len(tasks), 'failures': failures}, indent=2))
if failures: print('\n'.join(failures), file=sys.stderr); sys.exit(1)
