#!/usr/bin/env python3
"""Build, restart and inspect the installed macOS desktop through guarded LaunchAgents."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

TERMINAL = {'complete', 'rolled_back', 'recovery_failed', 'aborted', 'failed'}


def fingerprint(app):
    app = Path(app)
    digest = hashlib.sha256()
    for file in sorted(app.rglob('*')):
        digest.update(str(file.relative_to(app)).encode() + b'\0')
        if file.is_symlink():
            digest.update(b'link:' + os.readlink(file).encode())
        elif file.is_file():
            digest.update(str(file.stat().st_mode & 0o777).encode())
            with file.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
    return digest.hexdigest()


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + '.next')
    with temporary.open('w') as file:
        os.chmod(temporary, 0o600)
        json.dump(data, file, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(path)


def state(config):
    return json.loads(Path(config['result']).read_text())


def write_state(config, phase, **details):
    result = {**state(config), **details, 'phase': phase, 'updatedAt': time.time()}
    atomic_json(config['result'], result)
    return result


@contextlib.contextmanager
def locked(config):
    with (Path(config['work']) / 'mutation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def new_transaction(work, target, candidate, home, health_timeout=90):
    work, target, candidate, home = (Path(p).resolve() for p in [work, target, candidate, home])
    if target == candidate or target in candidate.parents or candidate in target.parents:
        raise ValueError('Candidate and installed app must be separate bundles.')
    suffix = work.name + '-' + uuid.uuid4().hex[:8]
    config = dict(work=str(work), target=str(target), candidate=str(candidate), home=str(home),
                  backup=str(target.parent / ('.' + target.stem + '-previous-' + suffix + '.app')),
                  failed=str(target.parent / ('.' + target.stem + '-failed-' + suffix + '.app')),
                  stateBackup=str(work / 'state-backup'), result=str(work / 'result.json'),
                  originalDigest=fingerprint(target), candidateDigest=fingerprint(candidate),
                  healthTimeout=health_timeout)
    atomic_json(config['result'], dict(phase='prepared', work=str(work), createdAt=time.time()))
    return config


def wait_healthy(lifecycle, app, checkpoint, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        evidence = lifecycle.healthy(Path(app), checkpoint)
        if evidence:
            return evidence
        time.sleep(.1)
    return None


@contextlib.contextmanager
def installation_lock(config, blocking=True):
    target = Path(config['target'])
    with (target.parent / ('.' + target.stem + '-update.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield


def recover(config, lifecycle, reason):
    with installation_lock(config):
        return _recover(config, lifecycle, reason)


def _recover(config, lifecycle, reason):
    with locked(config):
        current = state(config)
        if current['phase'] in TERMINAL:
            return current
        target, backup, failed = (Path(config[k]) for k in ['target', 'backup', 'failed'])
        try:
            write_state(config, 'recovering', error=str(reason))
            checkpoint = lifecycle.checkpoint()
            if backup.exists():
                if target.exists():
                    if fingerprint(target) != config['candidateDigest']:
                        raise RuntimeError('Installed app changed outside this transaction; refusing to overwrite it.')
                    lifecycle.stop(target)
                    target.rename(failed)
                if fingerprint(backup) != config['originalDigest']:
                    raise RuntimeError('Recovery app checksum changed.')
                backup.rename(target)
            elif not target.exists() or fingerprint(target) != config['originalDigest']:
                raise RuntimeError('Original app is unavailable or changed; manual recovery required.')
            lifecycle.verify(target)
            # A preflight/quit failure can leave the original healthy and running.
            baseline = current.get('initialCheckpoint') or lifecycle.checkpoint(history=True)
            health = wait_healthy(lifecycle, target, baseline, min(5, config['healthTimeout']))
            if not health:
                lifecycle.launch(target)
                health = wait_healthy(lifecycle, target, checkpoint, config['healthTimeout'])
            if not health:
                raise RuntimeError('Previous app relaunched but did not pass its recovery health check.')
            return write_state(config, 'rolled_back', health=health)
        except Exception as error:
            return write_state(config, 'recovery_failed', error=str(reason), recoveryError=str(error))


def activate(config, lifecycle):
    try:
        with installation_lock(config, blocking=False):
            return _activate(config, lifecycle)
    except BlockingIOError:
        return write_state(config, 'aborted', error='Another installer owns the application; nothing stopped or replaced.')


def _activate(config, lifecycle):
    target, candidate = Path(config['target']), Path(config['candidate'])
    try:
        baseline = lifecycle.checkpoint(history=True)
        with locked(config):
            if state(config)['phase'] in TERMINAL:
                return state(config)
            write_state(config, state(config)['phase'], initialCheckpoint=baseline)
            if fingerprint(target) != config['originalDigest'] or fingerprint(candidate) != config['candidateDigest']:
                raise RuntimeError('App checksum changed after staging.')
        lifecycle.verify(candidate)
        lifecycle.verify(target)
        checkpoint = lifecycle.checkpoint()
        with locked(config):
            if state(config)['phase'] in TERMINAL:
                return state(config)
            write_state(config, 'stopping', workerPid=os.getpid(), initialCheckpoint=baseline)
        lifecycle.stop(target)
        lifecycle.backup_state(Path(config['home']), Path(config['stateBackup']))
        with locked(config):
            if state(config)['phase'] in TERMINAL:
                return state(config)
            if fingerprint(target) != config['originalDigest']:
                raise RuntimeError('Installed app changed before replacement.')
            write_state(config, 'replacing')
            target.rename(config['backup'])
            candidate.rename(target)
            write_state(config, 'starting')
        lifecycle.launch(target)
        health = wait_healthy(lifecycle, target, checkpoint, config['healthTimeout'])
        if not health:
            raise RuntimeError('New app did not become healthy before its deadline.')
        with locked(config):
            if state(config)['phase'] in TERMINAL:
                return state(config)
            return write_state(config, 'complete', health=health, installedDigest=config['candidateDigest'])
    except Exception as error:
        return _recover(config, lifecycle, error)


def command(*args, timeout=60):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True, timeout=timeout).stdout


def processes():
    result = {}
    for line in command('/bin/ps', '-A', '-o', 'pid=,ppid=,lstart=,comm=').splitlines():
        fields = line.split(None, 7)
        if len(fields) == 8:
            result[int(fields[0])] = dict(pid=int(fields[0]), ppid=int(fields[1]), start=' '.join(fields[2:7]), executable=fields[7])
    return result


def same_process(record):
    return processes().get(record['pid']) == record


def read_since(file, cursor, limit=1024 * 1024):
    file = Path(file)
    if not file.exists():
        return ''
    info = file.stat()
    offset = cursor.get('offset', 0) if cursor.get('inode') == info.st_ino and info.st_size >= cursor.get('offset', 0) else 0
    with file.open('rb') as source:
        source.seek(max(offset, info.st_size - limit))
        return source.read().decode('utf8', errors='replace')


def log_cursor(file):
    file = Path(file)
    return dict(inode=file.stat().st_ino, offset=file.stat().st_size) if file.exists() else dict(inode=0, offset=0)


class MacLifecycle:
    def __init__(self, main_log, home, product, signing_team=None):
        self.main_log, self.home = Path(main_log), Path(home)
        self.product, self.signing_team = product, signing_team
        self.expected_pairing = self.pairing()
        self.stable_since = None
        self.stable_pid = None

    def pairing(self):
        file = self.home / 'companion/state.json'
        if not file.exists():
            return None
        data = json.loads(file.read_text())
        return hashlib.sha256(data.get('identity', '').encode()).hexdigest(), sorted(g['peerId'] for g in data.get('gateway', {}).get('grants', []))

    def verify(self, app):
        app = Path(app)
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        if info.get('CFBundleIdentifier') != self.product['appId']:
            raise RuntimeError('Unexpected application identity.')
        command('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
        command('/usr/sbin/spctl', '--assess', '--type', 'execute', app)
        identity = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=4', str(app)], check=True, capture_output=True, text=True).stderr
        team = re.search(r'^TeamIdentifier=(.+)$', identity, re.MULTILINE)
        if not team or (self.signing_team and team.group(1) != self.signing_team):
            raise RuntimeError('Unexpected signing team.')
        return dict(version=info['CFBundleShortVersionString'], team=team.group(1))

    def running(self, app):
        info = plistlib.loads((Path(app) / 'Contents/Info.plist').read_bytes())
        executable = str(Path(app) / 'Contents/MacOS' / info['CFBundleExecutable'])
        return [p for p in processes().values() if p['executable'] == executable]

    def stop(self, app):
        apps = self.running(app)
        table = processes()
        backends = [p for p in table.values() if p['ppid'] in {a['pid'] for a in apps} and p['executable'] == self.product['daemonName']]
        for process in apps:
            if same_process(process):
                os.kill(process['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 45
        while any(same_process(p) for p in apps) and time.monotonic() < deadline:
            time.sleep(.2)
        if any(same_process(p) for p in apps):
            raise RuntimeError('Desktop did not exit; installation was not replaced.')
        # The stdio child normally exits on EOF; give its provider shutdown time.
        for process in backends:
            if same_process(process):
                os.kill(process['pid'], signal.SIGTERM)
        deadline = time.monotonic() + 30
        while any(same_process(p) for p in backends) and time.monotonic() < deadline:
            time.sleep(.2)
        if any(same_process(p) for p in backends):
            raise RuntimeError('Previous backend did not shut down; installation was not replaced.')

    def checkpoint(self, history=False):
        self.stable_since = self.stable_pid = None
        main = log_cursor(self.main_log)
        if history:
            main['offset'] = 0
        return dict(main=main, daemon=log_cursor(self.home / 'logs/daemon.log'), history=history)

    def launch(self, app):
        if not self.running(app):
            command('/usr/bin/open', '-a', app, timeout=15)

    def healthy(self, app, checkpoint):
        apps = self.running(app)
        if len(apps) != 1 or not isinstance(checkpoint, dict):
            return None
        text = read_since(self.main_log, checkpoint['main'], 8 * 1024 * 1024 if checkpoint.get('history') else 1024 * 1024)
        if 'application initialized' not in text or 'created main window' not in text:
            return None
        version = plistlib.loads((Path(app) / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
        table = processes()
        matches = re.findall(r'(?:reconnected|connected) to backend (\{[^\n]+\})', text)
        for match in reversed(matches):
            try:
                data = json.loads(match)
            except ValueError:
                continue
            backend = table.get(data.get('pid'))
            if data.get('version') != version or not backend or backend['ppid'] != apps[0]['pid']:
                continue
            if self.pairing() != self.expected_pairing:
                raise RuntimeError('Pairing identity or grants changed during activation.')
            if self.stable_pid != apps[0]['pid']:
                self.stable_pid, self.stable_since = apps[0]['pid'], time.monotonic()
            if time.monotonic() - self.stable_since < 3:
                return None
            mobile = read_since(self.home / 'logs/daemon.log', checkpoint.get('daemon', {}))
            return dict(appPid=apps[0]['pid'], backendPid=backend['pid'], version=version,
                        workspaceSynchronized=True, windowCreated=True, pairingPreserved=True,
                        mobileReconnected='"msg":"updates reply"' in mobile)
        return None

    def backup_state(self, home, destination):
        destination.mkdir(mode=0o700)
        for name in ['roster.json', 'settings.json', 'provider-tokens.json', 'requirements.json', 'companion']:
            source = home / name
            if source.is_dir():
                shutil.copytree(source, destination / name)
            elif source.is_file():
                shutil.copy2(source, destination / name)
        # Conversation/provider homes remain where they are. Backups are never
        # automatically restored over work accepted after the app starts.


def load_config(path):
    path = Path(path).resolve()
    if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o022:
        raise RuntimeError('Job configuration must be owned by this user and not writable by others.')
    return json.loads(path.read_text())


def prepare(args):
    ensure_private_paths(args)
    candidate, target = Path(args.candidate).resolve(), Path(args.target).resolve()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(work, 0o700)
    if (work / 'config.json').exists():
        raise RuntimeError('Choose an unused transaction directory.')
    lifecycle = MacLifecycle(args.main_log, args.home, args.product)
    before = lifecycle.verify(target)
    lifecycle.signing_team = before['team']
    after = lifecycle.verify(candidate)
    staged = target.parent / ('.' + target.stem + '-candidate-' + uuid.uuid4().hex + '.app')
    command('/usr/bin/ditto', candidate, staged, timeout=180)
    lifecycle.verify(staged)
    if fingerprint(staged) != fingerprint(candidate):
        raise RuntimeError('Staged app differs from the verified source.')
    config = new_transaction(work, target, staged, args.home, args.health_timeout)
    helper = work / 'update.py'
    shutil.copy2(Path(__file__).resolve(), helper)
    os.chmod(helper, 0o500)
    config.update(mainLog=str(Path(args.main_log).resolve()), original=before, release=after,
                  product=args.product, signingTeam=before['team'],
                  workerLabel=args.product['appId'] + '.update.' + uuid.uuid4().hex,
                  guardLabel=args.product['appId'] + '.recovery.' + uuid.uuid4().hex,
                  domain='gui/' + str(os.getuid()), python=sys.executable,
                  helper=str(helper))
    atomic_json(work / 'config.json', config)
    return config


def arm(config, delay):
    if state(config)['phase'] != 'prepared':
        raise RuntimeError('This transaction has already been armed or completed.')
    work = Path(config['work'])
    config.update(notBefore=time.time() + delay, guardDeadline=time.time() + delay + 300)
    atomic_json(work / 'config.json', config)
    write_state(config, 'armed', notBefore=config['notBefore'], guardDeadline=config['guardDeadline'])
    for role in ['guard', 'worker']:
        label = config['guardLabel' if role == 'guard' else 'workerLabel']
        job = job_definition(label, [config['python'], config['helper'], role, str(work / 'config.json')], work, role)
        file = work / (role + '.plist')
        file.write_bytes(plistlib.dumps(job))
        os.chmod(file, 0o600)
        try:
            command('/bin/launchctl', 'bootstrap', config['domain'], file)
        except Exception:
            if role == 'guard':
                write_state(config, 'aborted', error='Recovery guard could not start; installer was not started.')
            # If the worker bootstrap fails, the independent guard remains
            # responsible for confirming/recovering the original installation.
            raise
    return state(config)


def job_definition(label, arguments, work, role):
    return dict(Label=label, ProgramArguments=arguments, RunAtLoad=True, KeepAlive=False,
                WorkingDirectory=str(work), StandardOutPath=str(work / (role + '.out.log')),
                StandardErrorPath=str(work / (role + '.err.log')),
                EnvironmentVariables={'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'PYTHONUNBUFFERED': '1'})


def run_guard(config, lifecycle):
    while state(config)['phase'] not in TERMINAL and time.time() < config['guardDeadline']:
        time.sleep(1)
    if state(config)['phase'] not in TERMINAL:
        # launchd terminates the worker and its process group before recovery;
        # it cannot later overwrite a restored installation.
        subprocess.run(['/bin/launchctl', 'bootout', config['domain'] + '/' + config['workerLabel']], capture_output=True)
        recover(config, lifecycle, 'Independent recovery deadline expired')
    for label in [config['workerLabel'], config['guardLabel']]:
        subprocess.run(['/bin/launchctl', 'bootout', config['domain'] + '/' + label], capture_output=True)


def repository_root():
    for parent in Path(__file__).resolve().parents:
        if (parent / 'core/src/product.json').is_file():
            return parent
    raise RuntimeError('Pass --repo with the source checkout.')


def home_directory(product, supplied=None):
    return Path(supplied or os.environ.get('APP_HOME') or Path.home() / product['homeDirectory']).expanduser().resolve()


def resolve_paths(args):
    args.repo = Path(args.repo).resolve() if args.repo else repository_root()
    args.product = json.loads((args.repo / 'core/src/product.json').read_text())
    args.home = home_directory(args.product, args.home)
    args.target = Path(args.target or '/Applications/' + args.product['name'] + '.app').resolve()
    args.main_log = Path(args.main_log or Path.home() / 'Library/Logs' / args.product['name'] / 'main.log').resolve()


def ensure_private_paths(args):
    paths = [args.home / 'desktop-updates']
    if args.work:
        paths.append(Path(args.work))
    for path in paths:
        resolved = path.resolve()
        if resolved == args.repo or args.repo in resolved.parents or any((p / '.git').exists() for p in [resolved, *resolved.parents]):
            raise RuntimeError('Private update state must be outside git checkouts.')


def build_candidate(args):
    env = {**os.environ, 'APP_SKIP_SIGNING': '0'}
    env.pop('TEST', None)
    for action, argv in [('build', ['npm', 'run', 'build']), ('smoke', ['node', 'scripts/smoke-desktop.mjs'])]:
        log = args.work / (action + '.log')
        with log.open('w') as output:
            os.chmod(log, 0o600)
            result = subprocess.run(argv, cwd=args.repo, env=env, stdout=output, stderr=output)
        if result.returncode:
            raise RuntimeError(f'{action} failed (exit {result.returncode}); inspect private log {log}')
    arch = {'arm64': 'arm64', 'x86_64': 'x64'}.get(platform.machine())
    if not arch:
        raise RuntimeError('Unsupported macOS architecture.')
    return args.repo / 'electron/out' / (args.product['name'] + '-darwin-' + arch) / (args.product['name'] + '.app')


def workflow(args):
    if sys.platform != 'darwin':
        raise RuntimeError('Desktop replacement requires macOS.')
    resolve_paths(args)
    try:
        ensure_private_paths(args)
    except RuntimeError as error:
        return dict(phase='failed', error=str(error))
    updates = args.home / 'desktop-updates'
    updates.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(updates, 0o700)
    args.work = Path(args.work).resolve() if args.work else updates / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    args.work.mkdir(parents=True, mode=0o700)
    os.chmod(args.work, 0o700)
    result_path = args.work / 'result.json'
    atomic_json(result_path, dict(phase='building' if args.action == 'deploy' else 'preparing', work=str(args.work), createdAt=time.time()))
    atomic_json(updates / 'latest.json', {'work': str(args.work)})
    try:
        args.candidate = build_candidate(args) if args.action == 'deploy' else args.target
        config = prepare(args)
        return arm(config, args.delay)
    except Exception as error:
        current = json.loads(result_path.read_text())
        # A partially armed transaction belongs to its independent recovery guard.
        if current['phase'] not in {'armed', 'aborted'}:
            current.update(phase='failed', error=str(error), updatedAt=time.time())
            atomic_json(result_path, current)
        return {**current, 'error': str(error)}


def delay_seconds(value):
    delay = float(value)
    if not 0 <= delay <= 3600:
        raise argparse.ArgumentTypeError('Delay must be between 0 and 3600 seconds.')
    return delay


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='action', required=True)
    for name in ['deploy', 'restart', 'prepare']:
        sub = subs.add_parser(name)
        sub.add_argument('--repo', help='Source checkout; inferred from the installed skill.')
        sub.add_argument('--target', help='Installed application bundle.')
        sub.add_argument('--home', help='Application home; defaults to APP_HOME or product metadata.')
        sub.add_argument('--main-log')
        sub.add_argument('--work', required=name == 'prepare', help='Unused private transaction directory.')
        sub.add_argument('--health-timeout', type=float, default=90)
        if name == 'prepare':
            sub.add_argument('candidate')
        else:
            sub.add_argument('--delay', type=delay_seconds, default=30)
    for name in ['arm', 'worker', 'guard']:
        sub = subs.add_parser(name)
        sub.add_argument('config')
        if name == 'arm':
            sub.add_argument('--delay', type=delay_seconds, default=30)
    status = subs.add_parser('status')
    status.add_argument('config', nargs='?')
    status.add_argument('--home', help='Application home for the latest transaction.')
    args = parser.parse_args(argv)
    if args.action in {'deploy', 'restart'}:
        result = workflow(args)
    elif args.action == 'prepare':
        resolve_paths(args)
        result = prepare(args)
    elif args.action == 'status':
        if args.config:
            result = state(load_config(args.config))
        else:
            product = json.loads((repository_root() / 'core/src/product.json').read_text())
            home = home_directory(product, args.home)
            pointer = home / 'desktop-updates/latest.json'
            if pointer.exists():
                latest = json.loads(pointer.read_text())
                result = json.loads((Path(latest['work']) / 'result.json').read_text())
            else:
                result = dict(phase='none', message='No desktop update transaction is recorded in this application home.')
    else:
        config = load_config(args.config)
        if args.action == 'arm':
            result = arm(config, args.delay)
        else:
            lifecycle = MacLifecycle(config['mainLog'], config['home'], config['product'], config['signingTeam'])
            if args.action == 'worker':
                time.sleep(max(0, config['notBefore'] - time.time()))
                result = activate(config, lifecycle)
            else:
                run_guard(config, lifecycle)
                result = state(config)
    print(json.dumps(result, indent=2))
    return 1 if result.get('error') or result.get('phase') in {'failed', 'aborted', 'recovery_failed', 'rolled_back'} else 0


if __name__ == '__main__':
    sys.exit(main())
