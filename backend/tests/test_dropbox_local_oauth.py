"""Isolated OAuth contract tests: no database, credentials or network needed."""
import ast
import base64
import hashlib
import os
from pathlib import Path
import secrets
import time
import types
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


class OAuthTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).parents[1] / 'integrations_dropbox.py').read_text(encoding='utf-8'))
        keep = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in {'_redirect_uri', 'dropbox_oauth_start', '_finish_oauth'}:
                node.decorator_list = []
                keep.append(node)
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_DROPBOX_SCOPES' for t in node.targets):
                keep.append(node)
        self.calls = []
        self.ns = dict(os=os, secrets=secrets, time=time, hashlib=hashlib, base64=base64,
                       urlsplit=urlsplit, Dict=dict, Any=object, Depends=lambda x: None,
                       _require_admin=lambda: None, HTTPException=HTTPException,
                       _OAUTH_STATES={}, _OAUTH_STATE_TTL_S=300,
                       _DROPBOX_AUTHORIZE_URL='https://www.dropbox.com/oauth2/authorize',
                       _DROPBOX_TOKEN_URL='https://api.dropboxapi.com/oauth2/token')
        self.env = patch.dict(os.environ, {'DROPBOX_APP_KEY':'test-key', 'DROPBOX_APP_SECRET':'test-secret',
                                          'FRONTEND_PUBLIC_URL':'http://umbrel.local:3952',
                                          'DROPBOX_REDIRECT_URI':''}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        exec(compile(ast.Module(keep, type_ignores=[]), '<oauth>', 'exec'), self.ns)

    def start(self):
        return self.ns['dropbox_oauth_start']({'id':'admin-a'})

    def test_local_uses_manual_pkce_and_user_scopes(self):
        result = self.start()
        query = parse_qs(urlsplit(result['authorize_url']).query)
        self.assertTrue(result['manual'])
        self.assertNotIn('redirect_uri', query)
        self.assertNotIn('files.permanent_delete', query['scope'][0])
        self.assertNotIn('team_data.member', query['scope'][0])
        self.assertIn('files.content.write', query['scope'][0])
        verifier = self.ns['_OAUTH_STATES'][result['state']]['verifier']
        self.assertEqual(query['code_challenge'][0], base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode())
        self.assertNotIn(verifier, str(result))

    def test_https_redirect_preserved(self):
        os.environ['FRONTEND_PUBLIC_URL'] = 'https://safety.paneltec.com.au'
        result = self.start()
        self.assertFalse(result['manual'])
        self.assertEqual(result['redirect_uri'], 'https://safety.paneltec.com.au/dropbox/callback')

    def test_wrong_owner_and_public_callback_cannot_complete_manual_flow(self):
        result = self.start()
        for manual, owner, status in [(True, 'other-admin', 403), (False, None, 400)]:
            with self.assertRaises(HTTPException) as error:
                self.ns['_finish_oauth']({'code':'test-code', 'state':result['state']}, manual, owner)
            self.assertEqual(error.exception.status_code, status)
        self.assertIn(result['state'], self.ns['_OAUTH_STATES'])

    def test_expiry(self):
        result = self.start()
        self.ns['_OAUTH_STATES'][result['state']]['created'] -= 301
        with self.assertRaises(HTTPException):
            self.ns['_finish_oauth']({'code':'test-code', 'state':result['state']}, True, 'admin-a')

    def test_exchange_omits_redirect_and_consumes_state(self):
        def post(url, data, timeout):
            self.calls.append(data)
            return types.SimpleNamespace(status_code=400, text='secret must not appear')
        self.ns['requests'] = types.SimpleNamespace(post=post, RequestException=RuntimeError)
        result = self.start()
        body = {'code':'test-code','state':result['state']}
        with self.assertRaises(HTTPException) as error:
            self.ns['_finish_oauth'](body, True, 'admin-a')
        self.assertNotIn('secret must not appear', error.exception.detail)
        self.assertNotIn('redirect_uri', self.calls[0])
        self.assertIn('code_verifier', self.calls[0])
        with self.assertRaises(HTTPException):
            self.ns['_finish_oauth'](body, True, 'admin-a')
        self.assertEqual(len(self.calls), 1)


if __name__ == '__main__':
    unittest.main()
