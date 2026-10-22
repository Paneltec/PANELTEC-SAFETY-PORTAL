"""Exercise the actual verifier using synthetic archives; no server or database."""
import ast
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import tempfile
import types
import unittest
import zipfile
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from unittest.mock import AsyncMock
from fastapi import HTTPException

SOURCE = Path(__file__).resolve().parents[2] / 'backup_service.py'

class VerifyTests(unittest.IsolatedAsyncioTestCase):
    def archive(self, missing=False):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('manifest.json', json.dumps({'snapshot_id':'test', 'scope':'full', 'collections':['workers'], 'total_documents':1}))
            if not missing:
                z.writestr('mongo/workers.json', '[{"id":"synthetic"}]')
        return b.getvalue()

    async def run_verify(self, data, storage='file', bad_hash=False):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'test.zip'
            path.write_bytes(data)
            snap = {'id':'test', 'sha256': 'wrong' if bad_hash else hashlib.sha256(data).hexdigest()}
            if storage == 'file': snap['filepath'] = str(path)
            elif storage == 'legacy': snap['gridfs_id'] = '000000000000000000000001'
            elif storage == 'missing': snap['filepath'] = str(path.with_name('missing.zip'))
            collection = types.SimpleNamespace(find_one=AsyncMock(return_value=snap), update_one=AsyncMock())
            stream = types.SimpleNamespace(readchunk=AsyncMock(side_effect=[data,b'']),close=AsyncMock())
            fs = types.SimpleNamespace(open_download_stream=AsyncMock(return_value=stream))
            tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
            fn = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == 'verify_snapshot')
            fn.decorator_list=[]
            module=ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[]))
            scope=dict(globals(),db=types.SimpleNamespace(bk_snapshots=collection),fs=fs,logger=logging.getLogger('test'),_now_iso=lambda:datetime.now(timezone.utc).isoformat())
            exec(compile(module,str(SOURCE),'exec'),scope)
            result=await scope['verify_snapshot']('test')
            if storage=='file': fs.open_download_stream.assert_not_awaited()
            if storage=='legacy': stream.close.assert_awaited_once()
            collection.update_one.assert_awaited_once()
            self.assertEqual(path.read_bytes(),data)
            return result

    async def test_filesystem_without_gridfs(self):
        self.assertTrue((await self.run_verify(self.archive()))['ok'])
    async def test_legacy_gridfs(self):
        self.assertTrue((await self.run_verify(self.archive(),'legacy'))['ok'])
    async def test_mismatched_hash(self):
        self.assertFalse((await self.run_verify(self.archive(),bad_hash=True))['ok'])
    async def test_missing_collection(self):
        self.assertFalse((await self.run_verify(self.archive(missing=True)))['ok'])
    async def test_missing_archive(self):
        with self.assertRaises(HTTPException) as error:
            await self.run_verify(self.archive(),'missing')
        self.assertEqual(error.exception.status_code,410)
    async def test_metadata_only(self):
        with self.assertRaises(HTTPException) as error:
            await self.run_verify(self.archive(),'none')
        self.assertEqual(error.exception.status_code,410)
    async def test_invalid_zip(self):
        with self.assertRaises(HTTPException) as error:
            await self.run_verify(b'not a zip')
        self.assertIn('not a valid ZIP',error.exception.detail)

if __name__ == '__main__': unittest.main()
