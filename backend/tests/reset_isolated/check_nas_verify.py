"""NAS verification with synthetic ZIPs and stubbed agent/database transport."""
import ast, hashlib, json, os, sys, tempfile, types, unittest, uuid, zipfile, importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, patch
ROOT=Path(__file__).resolve().parents[3]
SID='11111111-1111-4111-8111-111111111111'

class NasVerificationTests(unittest.IsolatedAsyncioTestCase):
    def agent(self, folder):
        tree=ast.parse((ROOT/'scripts/paneltec_backup_agent.py').read_text(encoding='utf-8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_verify_backup_zip')
        scope={'LOCAL_DIR':Path(folder),'Dict':dict,'Any':object,'os':os,'hashlib':hashlib,'json':json}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'agent','exec'),scope)
        return scope['_verify_backup_zip']
    def archive(self, folder, missing=False):
        path=Path(folder)/f'paneltec-civil-{SID}.zip'
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('manifest.json',json.dumps({'snapshot_id':SID,'scope':'full','collections':['workers'],'total_documents':1}))
            if not missing:z.writestr('mongo/workers.json','[{"id":"synthetic"}]')
        return path
    async def test_valid_zip_read_only(self):
        with tempfile.TemporaryDirectory() as folder:
            p=self.archive(folder);original=p.read_bytes();r=self.agent(folder)(SID)
            self.assertTrue(all(c['ok'] for c in r['checks']))
            self.assertEqual(r['sha256'],hashlib.sha256(original).hexdigest())
            self.assertEqual(p.read_bytes(),original)
    async def test_missing_collection_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            self.archive(folder,True);r=self.agent(folder)(SID)
            self.assertFalse(all(c['ok'] for c in r['checks']))
    async def test_missing_zip(self):
        with tempfile.TemporaryDirectory() as folder:self.assertFalse(self.agent(folder)(SID)['available'])
    async def test_invalid_path(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):self.agent(folder)('../secrets')
    async def server(self, settled, report=True, checksum='abc'):
        transport=types.SimpleNamespace(enqueue_op=AsyncMock(return_value={'id':'op'}),wait_for_result=AsyncMock(return_value=settled))
        with patch.dict(sys.modules,{'nas_ops_service':transport}):
            spec=importlib.util.spec_from_file_location('nas_verify_test',ROOT/'backend/backup_nas_verify.py')
            mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
            db=types.SimpleNamespace(bk_agent_logs=types.SimpleNamespace(find_one=AsyncMock(return_value={'agent_id':'agent-a'} if report else None)),bk_snapshots=types.SimpleNamespace(update_one=AsyncMock()))
            r=await mod.verify_nas_snapshot(db,{'id':SID,'sha256':checksum,'size':123})
            if report:transport.enqueue_op.assert_awaited_once_with('verify_backup',SID,agent_id='agent-a')
            else:transport.enqueue_op.assert_not_awaited()
            return r
    async def test_agent_timeout_is_pending(self):self.assertTrue((await self.server({'status':'timeout'}))['pending'])
    async def test_old_agent_is_pending(self):self.assertTrue((await self.server({'status':'error','error':'unknown op'}))['pending'])
    async def test_no_delivery_is_pending(self):self.assertTrue((await self.server({},False))['pending'])
    async def test_checksum_mismatch_fails(self):
        r=await self.server({'status':'done','result':{'available':True,'snapshot_id':SID,'size':123,'sha256':'wrong','checks':[{'name':'ZIP','ok':True}]}})
        self.assertFalse(r['pending']);self.assertFalse(r['ok'])
    async def test_verified(self):
        r=await self.server({'status':'done','result':{'available':True,'snapshot_id':SID,'size':123,'sha256':'abc','checks':[{'name':'ZIP','ok':True}]}})
        self.assertTrue(r['ok'])

if __name__=='__main__':unittest.main()
