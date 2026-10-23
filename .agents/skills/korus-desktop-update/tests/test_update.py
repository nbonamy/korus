"""Real app-directory replacement and subprocess recovery at the updater boundary.

Failure modes: corrupt staging, failed new process, lost worker after either rename,
refused termination, duplicate activation, stale watchdog, and unintended profile writes.
Apple signing/LaunchServices are replaced by a headless HTTP app lifecycle; files,
processes, timeouts, health requests and transaction journals are real.
"""
import importlib.util
import fcntl
import json
import os
from pathlib import Path
import plistlib
import platform
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import contextlib
import io
import shutil
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / 'scripts/update.py'
spec = importlib.util.spec_from_file_location('desktop_update', MODULE)
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)

APP = '''import http.server,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); bundle=pathlib.Path(sys.argv[2])
version=(bundle/'Contents/version').read_text()
if version=='broken': sys.exit(42)
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  body=json.dumps({'version':version}).encode();self.send_response(200);self.end_headers();self.wfile.write(body)
 def log_message(self,*args): pass
server=http.server.HTTPServer(('127.0.0.1',0),Handler)
(root/'runtime.json').write_text(json.dumps({'pid':__import__('os').getpid(),'port':server.server_port,'version':version}))
server.serve_forever()
'''


class Lifecycle:
    def __init__(self, root):
        self.root = root
        self.processes = []
        self.stops = 0
        self.refuse_stop = False

    def verify(self, app):
        if (app / 'invalid').exists():
            raise RuntimeError('Invalid signature')
        return {'version': (app / 'Contents/version').read_text(), 'team': 'fixture'}

    def checkpoint(self, history=False):
        return 0

    def stop(self, app):
        self.stops += 1
        if self.refuse_stop:
            raise RuntimeError('App did not exit')
        for child in self.processes:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=3)

    def launch(self, app):
        self.processes.append(subprocess.Popen([sys.executable, str(app / 'Contents/MacOS/Korus'), str(self.root), str(app)],
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    def healthy(self, app, checkpoint):
        try:
            d = json.loads((self.root / 'runtime.json').read_text())
            child = next(p for p in self.processes if p.pid == d['pid'] and p.poll() is None)
            with urllib.request.urlopen('http://127.0.0.1:%s/' % d['port'], timeout=.2) as reply:
                data = json.load(reply)
            if data['version'] == (app / 'Contents/version').read_text():
                return {'appPid': child.pid, 'version': data['version']}
        except (OSError, ValueError, StopIteration):
            pass
        return None

    def backup_state(self, home, destination):
        import shutil
        shutil.copytree(home, destination)

    def close(self):
        self.refuse_stop = False
        self.stop(None)


class DesktopUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.app('Applications/Korus.app', 'old')
        self.stage = self.app('Applications/.candidate.app', 'new')
        self.home = self.root / 'home'
        self.home.mkdir()
        (self.home / 'roster.json').write_text('existing conversations')
        (self.home / 'identity.key').write_bytes(b'pairing identity')
        self.before = {p.name: p.read_bytes() for p in self.home.iterdir()}
        self.work = self.root / 'job'
        self.work.mkdir(mode=0o700)
        self.config = update.new_transaction(self.work, self.target, self.stage, self.home, health_timeout=.8)
        self.lifecycle = Lifecycle(self.root)
        self.addCleanup(self.lifecycle.close)
        self.lifecycle.launch(self.target)
        self.assertIsNotNone(update.wait_healthy(self.lifecycle, self.target, 0, 2))

    def app(self, name, version):
        app = self.root / name
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/MacOS/Korus').write_text(APP)
        (app / 'Contents/version').write_text(version)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.nabocorp.korus', 'CFBundleExecutable': 'Korus', 'CFBundleShortVersionString': version}))
        return app

    def preserved(self):
        self.assertEqual(self.before, {p.name: p.read_bytes() for p in self.home.iterdir()})

    def test_success_replaces_entire_app_and_keeps_recoverable_old_app(self):
        result = update.activate(self.config, self.lifecycle)
        self.assertEqual(result['phase'], 'complete')
        self.assertEqual(result['health']['version'], 'new')
        self.assertEqual((Path(self.config['backup']) / 'Contents/version').read_text(), 'old')
        self.preserved()
        stops = self.lifecycle.stops
        self.assertEqual(update.activate(self.config, self.lifecycle)['phase'], 'complete')
        self.assertEqual(self.lifecycle.stops, stops)
        self.assertEqual(update.recover(self.config, self.lifecycle, 'stale watchdog')['phase'], 'complete')

    def test_failed_new_app_restores_and_relaunches_old_app(self):
        (self.stage / 'Contents/version').write_text('broken')
        self.config['candidateDigest'] = update.fingerprint(self.stage)
        result = update.activate(self.config, self.lifecycle)
        self.assertEqual(result['phase'], 'rolled_back')
        self.assertEqual(result['health']['version'], 'old')
        self.assertEqual((self.target / 'Contents/version').read_text(), 'old')
        self.assertTrue(Path(self.config['failed']).is_dir())
        self.preserved()

    def test_independent_recovery_handles_worker_loss_between_or_after_renames(self):
        for installed in [False, True]:
            with self.subTest(candidate_installed=installed):
                self.lifecycle.stop(self.target)
                update.write_state(self.config, 'replacing')
                self.target.rename(self.config['backup'])
                if installed:
                    self.stage.rename(self.target)
                result = update.recover(self.config, self.lifecycle, 'worker disappeared')
                self.assertEqual(result['phase'], 'rolled_back')
                self.assertEqual(result['health']['version'], 'old')
                self.assertIsNotNone(self.lifecycle.healthy(self.target, 0))
                self.preserved()
                if not installed:
                    update.write_state(self.config, 'armed')
                else:
                    break

    def test_refused_quit_keeps_the_original_app_running(self):
        self.lifecycle.refuse_stop = True
        result = update.activate(self.config, self.lifecycle)
        self.assertEqual(result['phase'], 'rolled_back')
        self.assertEqual(result['health']['version'], 'old')
        self.assertFalse(Path(self.config['backup']).exists())
        self.assertTrue(self.stage.exists())
        self.preserved()

    def test_corrupt_staging_cannot_stop_or_replace_the_running_app(self):
        (self.stage / 'Contents/version').write_text('tampered')
        result = update.activate(self.config, self.lifecycle)
        self.assertEqual(result['phase'], 'rolled_back')
        self.assertEqual(self.lifecycle.stops, 0)
        self.assertEqual(result['health']['version'], 'old')
        self.preserved()

    def test_an_operator_replacement_is_not_overwritten_by_recovery(self):
        self.lifecycle.stop(self.target)
        (self.target / 'Contents/version').write_text('operator replacement')
        result = update.recover(self.config, self.lifecycle, 'deadline')
        self.assertEqual(result['phase'], 'recovery_failed')
        self.assertEqual((self.target / 'Contents/version').read_text(), 'operator replacement')

    def test_another_installer_cannot_stop_the_app_while_installation_is_owned(self):
        with (self.target.parent / '.Korus-update.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = update.activate(self.config, self.lifecycle)
        self.assertEqual(result['phase'], 'aborted')
        self.assertEqual(self.lifecycle.stops, 0)
        self.assertIsNotNone(self.lifecycle.healthy(self.target, 0))
        self.assertFalse(Path(self.config['backup']).exists())
        self.preserved()



class WorkflowTest(unittest.TestCase):
    """Public commands must select the intended artifact, retain recovery, avoid
    unsigned builds, and leave a durable status without touching a real app."""
    app = DesktopUpdateTest.app

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'checkout'
        (self.repo / 'core/src').mkdir(parents=True)
        self.product = {'name': 'Korus', 'appId': 'com.nabocorp.korus', 'daemonName': 'korusd', 'homeDirectory': '.korus'}
        (self.repo / 'core/src/product.json').write_text(json.dumps(self.product))
        self.target = self.app('Applications/Korus.app', 'old')
        self.candidate = self.app('checkout/electron/out/Korus-darwin-arm64/Korus.app', 'new')
        self.home = self.root / 'profile'
        self.home.mkdir()
        (self.home / 'settings.json').write_text('keep this profile')
        self.jobs = []
        self.lifecycle = Lifecycle(self.root)
        self.addCleanup(self.lifecycle.close)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        tool = """#!/usr/bin/env python3
import json,os,pathlib,sys
repo=pathlib.Path.cwd()
name=pathlib.Path(sys.argv[0]).name
(repo/(name+'.json')).write_text(json.dumps({'argv':sys.argv[1:],'skip':os.environ.get('APP_SKIP_SIGNING'),'test':os.environ.get('TEST')}))
sys.exit(int(os.environ.get('FIXTURE_BUILD_FAIL','0')) if name=='npm' else 0)
"""
        for name in ['npm', 'node']:
            file = self.bin / name
            file.write_text(tool)
            file.chmod(0o700)
        self.addCleanup(patch.stopall)
        patch.object(update.sys, 'platform', 'darwin').start()
        patch.object(platform, 'machine', return_value='arm64').start()
        patch.dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'], APP_SKIP_SIGNING='1', TEST='1').start()
        patch.object(update, 'MacLifecycle', side_effect=lambda *a, **k: self.lifecycle).start()
        def command(*args, **kwargs):
            if args[0] == '/usr/bin/ditto': shutil.copytree(args[1], args[2]); return ''
            if args[:2] == ('/bin/launchctl', 'bootstrap'):
                self.jobs.append(plistlib.loads(Path(args[3]).read_bytes())); return ''
            raise AssertionError('Unexpected OS command: ' + str(args[0]))
        patch.object(update, 'command', side_effect=command).start()

    def call(self, mode, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = update.main([mode, '--repo', str(self.repo), '--home', str(self.home), '--target', str(self.target), *args])
        return result, json.loads(output.getvalue())

    def test_deploy_builds_signed_runs_smoke_and_arms_both_jobs_with_thirty_seconds(self):
        before = time.time()
        code, result = self.call('deploy')
        self.assertEqual(code, 0)
        self.assertEqual(result['phase'], 'armed')
        self.assertGreaterEqual(result['notBefore'], before + 30)
        self.assertLess(result['notBefore'], time.time() + 31)
        self.assertEqual(json.loads((self.repo / 'npm.json').read_text()), {'argv': ['run', 'build'], 'skip': '0', 'test': None})
        self.assertEqual(json.loads((self.repo / 'node.json').read_text())['argv'], ['scripts/smoke-desktop.mjs'])
        self.assertEqual(len(self.jobs), 2)
        self.assertTrue(all(j['RunAtLoad'] and not j['KeepAlive'] for j in self.jobs))
        work = Path(result['work'])
        config = update.load_config(work / 'config.json')
        self.assertEqual(config['candidateDigest'], update.fingerprint(self.candidate))
        self.assertTrue(config['candidate'] != config['target'])
        self.assertTrue(work.is_relative_to(self.home.resolve()))
        self.assertEqual((self.target / 'Contents/version').read_text(), 'old')
        self.assertEqual((work.stat().st_mode & 0o777), 0o700)
        # The frozen helper remains readable after leaving the source checkout.
        run = subprocess.run([sys.executable, config['helper'], 'status', str(work / 'config.json')], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)['phase'], 'armed')

    def test_restart_stages_the_installed_bundle_without_building_and_status_finds_it(self):
        code, result = self.call('restart')
        self.assertEqual(code, 0)
        config = update.load_config(Path(result['work']) / 'config.json')
        self.assertEqual(config['originalDigest'], config['candidateDigest'])
        self.assertFalse((self.repo / 'npm.json').exists())
        self.assertFalse((self.repo / 'node.json').exists())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(update.main(['status', '--home', str(self.home)]), 0)
        self.assertEqual(json.loads(output.getvalue()), result)

    def test_failed_build_leaves_installed_app_and_jobs_untouched_and_keeps_status(self):
        with patch.dict(os.environ, FIXTURE_BUILD_FAIL='17'):
            code, result = self.call('deploy')
        self.assertEqual(code, 1)
        self.assertEqual(result['phase'], 'failed')
        self.assertEqual(self.jobs, [])
        self.assertEqual((self.target / 'Contents/version').read_text(), 'old')
        self.assertFalse((self.repo / 'node.json').exists())
        output = io.StringIO()
        with contextlib.redirect_stdout(output): update.main(['status', '--home', str(self.home)])
        self.assertEqual(json.loads(output.getvalue())['phase'], 'failed')

    def test_failed_smoke_does_not_arm_an_installer(self):
        (self.bin / 'node').write_text('#!/bin/sh\nexit 23\n')
        code, result = self.call('deploy')
        self.assertEqual(code, 1)
        self.assertEqual(result['phase'], 'failed')
        self.assertEqual(self.jobs, [])
        self.assertEqual((self.target / 'Contents/version').read_text(), 'old')

    def test_private_transactions_are_rejected_inside_source_or_another_git_checkout(self):
        other = self.root / 'another-checkout'
        (other / '.git').mkdir(parents=True)
        for path in [self.repo / 'private-update', other / 'private-update']:
            with self.subTest(path=path):
                code, result = self.call('restart', '--work', str(path))
                self.assertEqual(code, 1)
                self.assertEqual(result['phase'], 'failed')
                self.assertFalse(path.exists())
                self.assertEqual(self.jobs, [])

    def test_status_without_a_transaction_is_read_only_and_reports_none(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = update.main(['status', '--home', str(self.home)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())['phase'], 'none')
        self.assertFalse((self.home / 'desktop-updates').exists())

if __name__ == '__main__':
    unittest.main()
