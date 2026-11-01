"""Full-command benchmark and fail-closed artifact aggregation; standard library only."""
import argparse, collections, hashlib, json, os, pathlib, re, signal, subprocess, sys, threading, time


def processes():
    if os.name == 'nt':
        raw = subprocess.check_output(['powershell', '-NoProfile', '-NonInteractive', '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress'], timeout=10)
        return [(int(x['ProcessId']), int(x['ParentProcessId']), int(x['WorkingSetSize'])) for x in json.loads(raw)]
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss='], timeout=5, text=True)
    return [(int(pid), int(parent), int(rss) * 1024) for pid, parent, rss in (line.split() for line in raw.splitlines())]


def sample_tree(pid):
    rows = processes(); children = collections.defaultdict(list); sizes = {}
    for child, parent, rss in rows:
        children[parent].append(child); sizes[child] = rss
    todo = [pid]; seen = set()
    while todo:
        current = todo.pop()
        if current in seen: continue
        seen.add(current); todo.extend(children[current])
    return sum(sizes.get(child, 0) for child in seen), len(seen & sizes.keys())


def run(args):
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command: raise ValueError('Missing command')
    output = pathlib.Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter(); done = threading.Event(); errors = []; events = []
    state = {'peak_tree_rss_bytes': 0, 'peak_processes': 0, 'samples': 0, 'timed_out': False}
    kwargs = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    # npm is a .cmd shim on hosted Windows runners.
    launch = subprocess.list2cmdline(command) if os.name == 'nt' else command
    process = subprocess.Popen(launch, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=os.name == 'nt', **kwargs)
    def stop():
        state['timed_out'] = True
        if os.name == 'nt': subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
        else:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
    def observe():
        while not done.is_set():
            try:
                rss, count = sample_tree(process.pid)
                state['peak_tree_rss_bytes'] = max(state['peak_tree_rss_bytes'], rss)
                state['peak_processes'] = max(state['peak_processes'], count); state['samples'] += 1
            except Exception as error:
                if len(errors) < 3: errors.append(str(error))
            done.wait(.1)
    observer = threading.Thread(target=observe, daemon=True); observer.start()
    timer = threading.Timer(args.timeout, stop); timer.start()
    try:
        with (output / (args.label + '.log')).open('wb') as log:
            for line in iter(process.stdout.readline, b''):
                log.write(line); sys.stdout.buffer.write(line); sys.stdout.buffer.flush()
                text = re.sub(r'\x1b\[[0-9;]*m', '', line.decode(errors='replace')).strip()
                if re.match(r'^> \S+@[^ ]+ \S+', text): events.append({'elapsed_seconds': time.perf_counter() - start, 'event': text})
        code = process.wait()
        elapsed = time.perf_counter() - start
    finally:
        timer.cancel(); done.set(); observer.join(timeout=12)
    try: sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True, stderr=subprocess.DEVNULL).strip()
    except subprocess.CalledProcessError: sha = None
    text = re.sub(r'\x1b\[[0-9;]*m', '', (output / (args.label + '.log')).read_text(errors='replace'))
    tests = {}; test_files = {}; workspace = None
    for line in text.splitlines():
        header = re.match(r'^> (\S+)@[^ ]+ (\S+)\s*$', line)
        if header:
            workspace = header[1] if header[2] in ['test', 'test:coverage', 'check'] else header[1] + ':' + header[2] if header[2].startswith('test:') else None
        if workspace and re.search(r'\bTests\s+', line):
            counts = dict((status, int(number)) for number, status in re.findall(r'(\d+)\s+(passed|failed|skipped|todo)', line))
            if counts: tests[workspace] = counts
        if workspace and re.search(r'\bTest Files\s+', line):
            counts = dict((status, int(number)) for number, status in re.findall(r'(\d+)\s+(passed|failed|skipped|todo)', line))
            if counts: test_files[workspace] = counts
        native = re.match(r'^(?:#|ℹ)\s+(tests|pass|fail|skipped|todo)\s+(\d+)$', line)
        if workspace and native:
            key = {'tests': 'total', 'pass': 'passed', 'fail': 'failed', 'skipped': 'skipped', 'todo': 'todo'}[native[1]]
            tests.setdefault(workspace, {})[key] = int(native[2])
    surfaces = {}; statements = {}
    for report in [*pathlib.Path.cwd().glob('*/coverage/coverage-final.json'), *pathlib.Path.cwd().glob('packages/*/coverage/coverage-final.json')]:
        coverage = json.loads(report.read_text()); key = str(report.parent.parent.relative_to(pathlib.Path.cwd()))
        surfaces[key] = sorted(os.path.relpath(pathlib.Path(file).resolve(), pathlib.Path.cwd()) for file in coverage)
        counters = [count for file in coverage.values() for count in file['s'].values()]
        statements[key] = {'covered': sum(count > 0 for count in counters), 'total': len(counters)}
    metric = {'label': args.label, 'command': command, 'cwd': os.getcwd(), 'sha': sha, 'exit_code': code,
        'elapsed_seconds': elapsed, **state, 'memory_sampling_errors': errors,
        'memory_method': 'summed live process-tree RSS; ps on Unix, CIM on Windows; shared pages may be counted twice',
        'requested_sample_interval_seconds': .1, 'logical_cpus': os.cpu_count(), 'tests': tests, 'test_files': test_files,
        'coverage_surface': surfaces, 'statement_counts': statements, 'npm_events': events,
        'fast_checkers': os.environ.get('CI_BENCH_FAST') == '1'}
    metric['node_version'] = subprocess.check_output(['node', '--version'], text=True).strip()
    lock = pathlib.Path('package-lock.json')
    metric['lockfile_sha256'] = hashlib.sha256(lock.read_bytes()).hexdigest() if lock.exists() else None
    (output / ('metric-' + args.label + '.json')).write_text(json.dumps(metric, indent=2) + '\n')
    print(json.dumps(metric), flush=True)
    return code if code >= 0 else 128 - code


def require_successful_jobs():
    needs = json.loads(os.environ.get('CI_BENCH_NEEDS', '{}'))
    bad = [key for key, value in needs.items() if value.get('result') != 'success']
    if bad: raise ValueError('Unsuccessful or skipped prerequisites: ' + ', '.join(bad))


def aggregate(args):
    require_successful_jobs()
    results = {}
    for file in pathlib.Path(args.input).rglob('metric-*.json'):
        metric = json.loads(file.read_text()); label = metric['label']
        if label in results: raise ValueError('Duplicate result: ' + label)
        results[label] = metric
    for label in args.expect:
        if label not in results: raise ValueError('Missing result: ' + label)
        if results[label]['exit_code'] != 0: raise ValueError('Failed result: ' + label)
    report = {label: results[label] for label in args.expect}
    pathlib.Path(args.input, 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({label: {key: value.get(key) for key in ['elapsed_seconds', 'peak_tree_rss_bytes', 'tests']} for label, value in report.items()}, indent=2))
    return 0


def compare(args):
    require_successful_jobs(); groups = {key: {'tests': {}, 'coverage_surface': {}} for key in ['baseline', 'optimized']}; metrics = []
    for file in pathlib.Path(args.input).rglob('metric-*.json'):
        metric = json.loads(file.read_text()); metrics.append(metric)
        group = next((key for key in groups if metric['label'].startswith(key)), None)
        if group is None: continue
        if metric['exit_code'] != 0: raise ValueError('Failed measurement: ' + metric['label'])
        for field in ['tests', 'coverage_surface']:
            for key, value in metric.get(field, {}).items():
                if key in groups[group][field] and groups[group][field][key] != value: raise ValueError('Conflicting inventory: ' + key)
                groups[group][field][key] = value
    baseline = groups['baseline']; optimized = groups['optimized']
    if not baseline['tests']: raise ValueError('Missing baseline test inventory')
    if baseline['tests'].keys() != optimized['tests'].keys(): raise ValueError('Different tested workspace sets')
    for key, counts in baseline['tests'].items():
        actual = optimized['tests'][key]
        if key.endswith(':test:scripts'):
            # The experiment adds its own harness regression cases to the script gate.
            if any(actual.get(field, 0) < count for field, count in counts.items()): raise ValueError('Smaller script test inventory: ' + key)
        elif actual != counts: raise ValueError('Different product test counts: ' + key)
    if baseline['coverage_surface'] != optimized['coverage_surface']: raise ValueError('Different measured coverage file sets')
    report = {'inventories': groups, 'measurements': metrics, 'result': 'matching product test counts and coverage surfaces'}
    pathlib.Path(args.input, 'comparison.json').write_text(json.dumps(report, indent=2) + '\n'); print(report['result']); return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); modes = parser.add_subparsers(dest='mode', required=True)
    command = modes.add_parser('run'); command.add_argument('--label', required=True); command.add_argument('--output', required=True)
    command.add_argument('--timeout', type=float, default=2400); command.add_argument('command', nargs=argparse.REMAINDER)
    command = modes.add_parser('aggregate'); command.add_argument('--input', required=True); command.add_argument('--expect', action='append', required=True)
    command = modes.add_parser('compare'); command.add_argument('--input', required=True)
    args = parser.parse_args()
    try: sys.exit({'run': run, 'aggregate': aggregate, 'compare': compare}[args.mode](args))
    except Exception as error: print(str(error), file=sys.stderr); sys.exit(1)
