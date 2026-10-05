import copy
import importlib.util
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs, unquote

spec = importlib.util.spec_from_file_location('updater', Path(__file__).with_name('paneltec_updater.py'))
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
SHA = 'b' * 40

def container(service):
    return {'Id': 'old-' + service, 'Name': '/' + u.PROJECT + '-' + service + '-1',
            'Config': {'Image': u.IMAGES + service + ':' + u.CHANNEL + '-' + 'a' * 40,
                       'Env': ['PRIVATE_TOKEN=kept'], 'Cmd': ['original-command'],
                       'Labels': {'com.docker.compose.project': u.PROJECT, 'com.docker.compose.service': service}},
            'HostConfig': {'NetworkMode': 'host', 'Binds': ['paneltec_recovery_uploads:/app/uploads'], 'RestartPolicy': {'Name': 'unless-stopped'}},
            'State': {'Running': True, 'Status': 'running', 'Health': {'Status': 'healthy'}}}

class DockerFake:
    def __init__(self):
        self.items = {s: container(s) for s in u.SERVICES}
        self.calls = []
        self.fail_pull = False
        self.fail_create = False
    def inspect(self, name, missing=False):
        for item in self.items.values():
            if name in (item['Id'], item['Name'].lstrip('/')): return copy.deepcopy(item)
        if missing: return None
        raise RuntimeError('missing')
    def call(self, method, path, data=None, **kw):
        self.calls.append((method, path, copy.deepcopy(data)))
        route = urlsplit(path)
        if route.path == '/images/create':
            if self.fail_pull: raise RuntimeError('pull failed')
            return {}
        if route.path == '/containers/create':
            if self.fail_create: raise RuntimeError('create failed')
            name = parse_qs(route.query)['name'][0]
            ident = 'new-' + name
            self.items[ident] = {'Id': ident, 'Name': '/' + name,
                                'Config': {k: v for k,v in data.items() if k != 'HostConfig'},
                                'HostConfig': data['HostConfig'], 'State': {'Running': False}}
            return {'Id': ident}
        ident = unquote(route.path.split('/')[2])
        item = next(v for v in self.items.values() if v['Id'] == ident)
        if method == 'DELETE':
            assert parse_qs(route.query).get('v') == ['false']
            self.items = {k: v for k,v in self.items.items() if v['Id'] != ident}
        elif route.path.endswith('/stop'): item['State']['Running'] = False
        elif route.path.endswith('/start'): item['State']['Running'] = True
        elif route.path.endswith('/rename'): item['Name'] = '/' + parse_qs(route.query)['name'][0]
        return {}

class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        u.STATE_PATH = Path(self.temp.name) / 'state.json'
        u.STATE.clear(); u.STATE.update({'phase': 'idle', 'previous': []})
        self.fake = DockerFake()
        for target, value in [('docker', self.fake.call), ('inspect', self.fake.inspect),
                              ('release', lambda: {'sha': SHA}), ('healthy', lambda *a: None), ('web_ready', lambda: None)]:
            p = patch.object(u, target, value); p.start(); self.addCleanup(p.stop)
    def run_install(self):
        self.assertTrue(u.LOCK.acquire(False)); u.install(SHA)
    def test_wrong_project_rejected(self):
        self.fake.items['backend']['Config']['Labels']['com.docker.compose.project'] = 'paneltec-test'
        self.run_install()
        self.assertEqual(u.STATE['phase'], 'failed')
        self.assertEqual(self.fake.calls, [])
    def test_failed_pull_does_not_stop_anything(self):
        self.fake.fail_pull = True; self.run_install()
        self.assertFalse(any('/stop' in p for _,p,_ in self.fake.calls))
        self.assertTrue(all(c['State']['Running'] for c in self.fake.items.values()))
    def test_both_downloads_before_stop_and_volumes_preserved(self):
        self.run_install()
        calls = self.fake.calls
        first_stop = next(i for i,(_,p,_) in enumerate(calls) if '/stop' in p)
        self.assertEqual(sum('/images/create' in p for _,p,_ in calls[:first_stop]), 2)
        creates = [data for _,p,data in calls if p.startswith('/containers/create?')]
        self.assertEqual(len(creates), 2)
        for config in creates:
            self.assertEqual(config['Env'], ['PRIVATE_TOKEN=kept'])
            self.assertEqual(config['HostConfig']['Binds'], ['paneltec_recovery_uploads:/app/uploads'])
            self.assertTrue(config['Image'].endswith(SHA))
        self.assertEqual(u.STATE['phase'], 'complete')
        self.assertEqual(len(u.STATE['previous']), 2)
        self.assertFalse(any('mongo' in p or '/volumes' in p for _,p,_ in calls))
    def test_create_failure_restores_originals(self):
        self.fake.fail_create = True; self.run_install()
        self.assertEqual(u.STATE['phase'], 'failed')
        for service in u.SERVICES:
            c = self.fake.inspect(u.PROJECT + '-' + service + '-1')
            self.assertEqual(c['Id'], 'old-' + service)
            self.assertTrue(c['State']['Running'])
    def test_health_failure_restores_originals(self):
        count = [0]
        def health(*args):
            count[0] += 1
            if count[0] == 1: raise RuntimeError('unhealthy replacement')
        with patch.object(u, 'healthy', health): self.run_install()
        self.assertEqual(u.STATE['phase'], 'failed')
        self.assertEqual(self.fake.inspect(u.PROJECT + '-backend-1')['Id'], 'old-backend')
    def test_explicit_rollback(self):
        self.run_install()
        self.assertTrue(u.LOCK.acquire(False)); u.rollback()
        self.assertEqual(u.STATE['phase'], 'complete')
        self.assertEqual(u.STATE['previous'], [])
        self.assertEqual(self.fake.inspect(u.PROJECT + '-web-1')['Id'], 'old-web')
    def test_release_changed_prevents_download(self):
        with patch.object(u, 'release', lambda: {'sha': 'c' * 40}): self.run_install()
        self.assertEqual(self.fake.calls, [])
    def test_configuration_copy_does_not_mutate_original(self):
        old = container('backend'); before = copy.deepcopy(old)
        result = u.create_config(old, 'new-image')
        self.assertEqual(old, before)
        self.assertEqual(result['Image'], 'new-image')
    def test_authentication_requires_matching_private_token(self):
        handler = object.__new__(u.Handler)
        handler.headers = {'Authorization': 'Bearer ' + 'x' * 40}
        with patch.dict(u.os.environ, {'PANELTEC_UPDATER_TOKEN': 'y' * 40}):
            self.assertFalse(handler.authorized())
        with patch.dict(u.os.environ, {'PANELTEC_UPDATER_TOKEN': 'x' * 40}):
            self.assertTrue(handler.authorized())

if __name__ == '__main__': unittest.main()
