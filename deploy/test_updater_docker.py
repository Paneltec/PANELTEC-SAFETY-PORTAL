"""Disposable Docker lifecycle checks, explicitly limited to GitHub CI."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

spec = importlib.util.spec_from_file_location('updater_live', Path(__file__).with_name('paneltec_updater.py'))
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
OLD = 'a' * 40
NEW = 'b' * 40


@unittest.skipUnless(os.environ.get('GITHUB_ACTIONS') == 'true', 'Disposable containers run only on GitHub CI')
class DockerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        u.STATE_PATH = Path(self.temp.name) / 'state.json'
        u.STATE.clear()
        u.STATE.update({'phase': 'idle', 'previous': []})
        self.ids = []
        self.addCleanup(self.cleanup_containers)
        self.real_docker = u.docker
        for service in u.SERVICES:
            name = u.PROJECT + '-' + service + '-1'
            self.assertIsNone(u.inspect(name, missing=True), 'Refusing to use a pre-existing container')
            for sha in (OLD, NEW):
                self.real_docker('POST', '/images/python:3.11-slim/tag?' + urlencode({
                    'repo': u.IMAGES + service, 'tag': u.CHANNEL + '-' + sha,
                }))
            config = {
                'Image': u.IMAGES + service + ':' + u.CHANNEL + '-' + OLD,
                'Env': ['PANELTEC_TEST_VALUE=preserved'],
                'Cmd': ['python', '-m', 'http.server', '3952'] if service == 'web' else ['python', '-c', 'import time; time.sleep(600)'],
                'Labels': {'com.docker.compose.project': u.PROJECT, 'com.docker.compose.service': service},
                'HostConfig': {'NetworkMode': 'host', 'RestartPolicy': {'Name': 'unless-stopped'},
                               'Binds': [self.temp.name + ':/test-preserved']},
            }
            if service == 'backend':
                config['Healthcheck'] = {'Test': ['CMD', 'python', '-c', 'pass'], 'Interval': 1000000000, 'Timeout': 1000000000, 'Retries': 3}
            c = self.real_docker('POST', '/containers/create?' + urlencode({'name': name}), config)
            self.ids.append(c['Id'])
            self.real_docker('POST', '/containers/' + c['Id'] + '/start')
            u.healthy(name, service, timeout=30)
        u.web_ready()
        def calls(method, path, data=None, **kwargs):
            if path.startswith('/images/create?'):
                return {}  # Already-tagged local images; all container operations are real.
            result = self.real_docker(method, path, data, **kwargs)
            if path.startswith('/containers/create?'):
                self.ids.append(result['Id'])
            return result
        p = patch.object(u, 'docker', calls); p.start(); self.addCleanup(p.stop)
        p = patch.object(u, 'release', lambda: {'sha': NEW}); p.start(); self.addCleanup(p.stop)

    def cleanup_containers(self):
        for identifier in self.ids:
            self.real_docker('DELETE', '/containers/' + identifier + '?force=true&v=false', missing=True)

    def test_install_preserves_mounts_and_environment_then_rolls_back(self):
        originals = dict(u.current())
        self.assertTrue(u.LOCK.acquire(False)); u.install(NEW)
        self.assertEqual(u.STATE['phase'], 'complete', u.STATE)
        self.assertEqual(u.current(), {s: NEW for s in u.SERVICES})
        for service in u.SERVICES:
            c = u.inspect(u.PROJECT + '-' + service + '-1')
            self.assertIn('PANELTEC_TEST_VALUE=preserved', c['Config']['Env'])
            self.assertIn(self.temp.name + ':/test-preserved', c['HostConfig']['Binds'])
        self.assertTrue(u.LOCK.acquire(False)); u.rollback()
        self.assertEqual(u.STATE['phase'], 'complete', u.STATE)
        self.assertEqual(u.current(), originals)

    def test_failed_health_check_restores_running_original_containers(self):
        real_health = u.healthy
        def health(name, service, timeout=240):
            if u.inspect(name)['Config']['Image'].endswith(NEW):
                raise RuntimeError('Intentional unhealthy release')
            return real_health(name, service, timeout=30)
        with patch.object(u, 'healthy', health):
            self.assertTrue(u.LOCK.acquire(False)); u.install(NEW)
        self.assertEqual(u.STATE['phase'], 'failed', u.STATE)
        self.assertEqual(u.current(), {s: OLD for s in u.SERVICES})
        for service in u.SERVICES:
            self.assertTrue(u.inspect(u.PROJECT + '-' + service + '-1')['State']['Running'])


if __name__ == '__main__':
    unittest.main()
