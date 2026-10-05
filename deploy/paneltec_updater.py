"""Loopback-only recovery updater. Never accepts arbitrary Docker commands.

Only the two named recovery app containers are managed. Mongo and volumes are
never deleted. Retained containers support image rollback (not DB migrations).
"""
import copy
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

PROJECT = 'paneltec-recovery'
REPO = 'Paneltec/PANELTEC-SAFETY-PORTAL'
CHANNEL = 'walkers-design-handover'
IMAGES = 'ghcr.io/paneltec/paneltec-safety-portal/'
SERVICES = ('backend', 'web')
STATE_PATH = Path(os.environ.get('UPDATER_STATE_FILE', '/state/update.json'))
LOCK = threading.Lock()
STATE_LOCK = threading.RLock()
STATE = {'phase': 'idle', 'message': 'Ready to check for updates.', 'previous': []}


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=900)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker(method, path, data=None, missing=False, stream=False):
    conn = DockerConnection()
    try:
        body = json.dumps(data).encode() if data is not None else None
        conn.request(method, path, body=body, headers={'Content-Type': 'application/json'})
        response = conn.getresponse()
        if missing and response.status == 404:
            return None
        if response.status >= 400:
            # Docker errors can embed configuration. Keep those out of responses.
            raise RuntimeError('Docker operation failed (HTTP %s).' % response.status)
        if stream:
            while True:
                line = response.readline()
                if not line:
                    break
                if line.strip() and json.loads(line).get('error'):
                    raise RuntimeError('Image download failed. Existing app kept.')
            return None
        raw = response.read()
        return json.loads(raw) if raw else {}
    finally:
        conn.close()


def inspect(name, missing=False):
    return docker('GET', '/containers/' + quote(name, safe='') + '/json', missing=missing)


def validate_container(container, service):
    labels = container['Config'].get('Labels') or {}
    if (labels.get('com.docker.compose.project') != PROJECT
            or labels.get('com.docker.compose.service') != service
            or container['HostConfig'].get('NetworkMode') != 'host'):
        raise RuntimeError('Container does not match the recovery deployment. No update performed.')
    if not container['Config']['Image'].startswith(IMAGES + service + ':'):
        raise RuntimeError('Unexpected app image. No update performed.')


def save(**changes):
    with STATE_LOCK:
        STATE.update(changes)
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp = STATE_PATH.with_suffix('.tmp')
        temp.write_text(json.dumps(STATE), encoding='utf-8')
        os.chmod(temp, 0o600)
        temp.replace(STATE_PATH)


def github(path):
    request = Request('https://api.github.com/repos/' + REPO + path,
                      headers={'User-Agent': 'Paneltec-Updater', 'Accept': 'application/vnd.github+json'})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def release():
    runs = github('/actions/workflows/build-images.yml/runs?' + urlencode({
        'branch': CHANNEL, 'status': 'success', 'per_page': 1,
    })).get('workflow_runs') or []
    if not runs:
        raise RuntimeError('No successful release is available.')
    run = runs[0]
    sha = run['head_sha']
    if (run.get('conclusion') != 'success' or run.get('head_branch') != CHANNEL
            or not re.fullmatch('[0-9a-f]{40}', sha)):
        raise RuntimeError('Release validation failed.')
    return {'sha': sha, 'title': run.get('display_title', 'Paneltec update'),
            'url': run['html_url'], 'built_at': run['updated_at']}


def current():
    result = {}
    for service in SERVICES:
        container = inspect(PROJECT + '-' + service + '-1')
        validate_container(container, service)
        result[service] = container['Config']['Image'].rsplit(':', 1)[-1].removeprefix(CHANNEL + '-')
    return result


def create_config(old, image):
    # Explicitly preserve the deployed command, health checks, environment,
    # named mounts, restart policy and labels. Never infer new volume names.
    config = copy.deepcopy(old['Config'])
    config['Image'] = image
    config['HostConfig'] = copy.deepcopy(old['HostConfig'])
    config['HostConfig'].pop('ContainerIDFile', None)
    # Do not clone the old container's Docker-generated hostname.
    config.pop('Hostname', None)
    return config


def healthy(name, service, timeout=240):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        c = inspect(name)
        state = c['State']
        health = (state.get('Health') or {}).get('Status')
        if state.get('Running') and (health == 'healthy' if service == 'backend' else health in (None, 'healthy')):
            return
        if state.get('Status') in ('exited', 'dead') or health == 'unhealthy':
            break
        time.sleep(3)
    raise RuntimeError(service + ' did not become healthy.')


def web_ready():
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:3952/', timeout=5) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('Website did not respond after the update.')


def restore(records):
    # The original containers still hold the original image IDs and mounts.
    for record in reversed(records):
        old = inspect(record['id'])
        validate_container(old, record['service'])
        active = inspect(record['name'], missing=True)
        if active and active['Id'] != record['id']:
            validate_container(active, record['service'])
            if active['Config']['Image'] != record['replacement']:
                raise RuntimeError('Replacement container changed outside this update.')
            # Remove only the replacement app container, never its volumes.
            docker('DELETE', '/containers/' + active['Id'] + '?force=true&v=false')
        if old['Name'].lstrip('/') != record['name']:
            docker('POST', '/containers/' + record['id'] + '/rename?' + urlencode({'name': record['name']}))
    for service in SERVICES:
        for record in records:
            if record['service'] == service:
                docker('POST', '/containers/' + record['id'] + '/start')
                healthy(record['name'], service)
    web_ready()


def install(target):
    records = []
    try:
        selected = release()
        if target != selected['sha']:
            raise RuntimeError('The available release changed. Check for updates again.')
        snapshots = []
        for service in SERVICES:
            name = PROJECT + '-' + service + '-1'
            old = inspect(name)
            validate_container(old, service)
            snapshots.append((service, name, old))
        save(phase='downloading', message='Downloading both app images. The app stays available.')
        for service in SERVICES:
            image = IMAGES + service + ':' + CHANNEL + '-' + target
            docker('POST', '/images/create?' + urlencode({'fromImage': image}), stream=True)
        # Discard only the previous retained app containers, after both new
        # images downloaded successfully. No image/volume prune is performed.
        for retained in STATE.get('previous', []):
            old = inspect(retained['id'], missing=True)
            if old and old['Name'].lstrip('/') != retained['name'] and not old['State']['Running']:
                validate_container(old, retained['service'])
                docker('DELETE', '/containers/' + old['Id'] + '?v=false')
        save(previous=[])
        records = [{'service': service, 'name': name, 'id': old['Id'],
                    'replacement': IMAGES + service + ':' + CHANNEL + '-' + target}
                   for service, name, old in snapshots]
        # Persist the recovery plan before touching a running container.
        save(phase='installing', message='Installing update. The app will reconnect shortly.', recovery=records)
        for service, name, old in reversed(snapshots):
            docker('POST', '/containers/' + old['Id'] + '/stop?t=30')
            docker('POST', '/containers/' + old['Id'] + '/rename?' + urlencode({'name': name + '-previous'}))
        for service, name, old in snapshots:
            image = IMAGES + service + ':' + CHANNEL + '-' + target
            made = docker('POST', '/containers/create?' + urlencode({'name': name}), create_config(old, image))
            docker('POST', '/containers/' + made['Id'] + '/start')
            healthy(name, service)
        web_ready()
        save(phase='complete', message='Update installed successfully. Reload the app.', previous=records,
             recovery=[], installed_sha=target)
    except Exception:
        if records:
            save(phase='restoring', message='Update failed. Restoring the previous app images.')
            try:
                restore(records)
                save(phase='failed', message='Update failed; the previous app version was restored.', recovery=[])
            except Exception:
                save(phase='recovery_required', message='Automatic recovery needs attention in Portainer.', recovery=records)
        else:
            save(phase='failed', message='Update could not start. Existing app containers were not changed.')
    finally:
        LOCK.release()


def rollback():
    try:
        records = copy.deepcopy(STATE.get('previous') or [])
        if not records:
            raise RuntimeError('No previous version is retained.')
        save(phase='restoring', message='Restoring previous app images.', recovery=records)
        restore(records)
        save(phase='complete', message='Previous app version restored. Reload the app.', previous=[], recovery=[])
    except Exception:
        save(phase='recovery_required', message='Rollback needs attention in Portainer.')
    finally:
        LOCK.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log authentication headers or request bodies.

    def reply(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        token = os.environ.get('PANELTEC_UPDATER_TOKEN', '')
        return len(token) >= 32 and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token)

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {'detail': 'Unauthorized'})
        if self.path not in ('/status', '/check'):
            return self.reply(404, {'detail': 'Not found'})
        try:
            with STATE_LOCK:
                result = {k: STATE.get(k) for k in ('phase', 'message', 'installed_sha')}
                result['can_rollback'] = bool(STATE.get('previous')) and not LOCK.locked()
            result['busy'] = LOCK.locked()
            if not result['busy']:
                result['current'] = current()
            if self.path == '/check':
                result['release'] = release()
                result['available'] = any(v != result['release']['sha'] for v in result.get('current', {}).values())
            self.reply(200, result)
        except Exception:
            self.reply(503, {'detail': 'Could not check the updater, Docker or GitHub. Try again shortly.'})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'detail': 'Unauthorized'})
        if self.path not in ('/install', '/rollback'):
            return self.reply(404, {'detail': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 1024:
                raise ValueError()
            body = json.loads(self.rfile.read(size) or b'{}')
            sha = body.get('sha', '')
            if self.path == '/install' and not re.fullmatch('[0-9a-f]{40}', sha):
                raise ValueError()
        except Exception:
            return self.reply(400, {'detail': 'Invalid request'})
        if not LOCK.acquire(blocking=False):
            return self.reply(409, {'detail': 'An update is already running'})
        if STATE.get('phase') == 'recovery_required':
            LOCK.release()
            return self.reply(409, {'detail': 'Resolve the previous recovery in Portainer first'})
        if self.path == '/rollback' and not STATE.get('previous'):
            LOCK.release()
            return self.reply(409, {'detail': 'No previous version is available'})
        save(phase='starting', message='Preparing the app update.')
        worker = threading.Thread(target=install if self.path == '/install' else rollback,
                                  args=(sha,) if self.path == '/install' else (), daemon=True)
        worker.start()
        self.reply(202, {'accepted': True})


def main():
    if len(os.environ.get('PANELTEC_UPDATER_TOKEN', '')) < 32:
        raise RuntimeError('A private updater token of at least 32 characters is required')
    if STATE_PATH.exists():
        STATE.update(json.loads(STATE_PATH.read_text(encoding='utf-8')))
    if STATE.get('recovery'):
        try:
            restore(STATE['recovery'])
            save(phase='failed', message='Interrupted update recovered to the previous app version.', recovery=[])
        except Exception:
            save(phase='recovery_required', message='Interrupted update needs attention in Portainer.')
    elif STATE.get('phase') in ('starting', 'downloading'):
        save(phase='failed', message='Download interrupted. The running app was not changed.')
    ThreadingHTTPServer(('127.0.0.1', 8022), Handler).serve_forever()


if __name__ == '__main__':
    main()
