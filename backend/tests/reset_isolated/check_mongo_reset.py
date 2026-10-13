"""Disposable GitHub Actions Mongo only. Never imports the app database config."""
import os,unittest
from check_reset import reset,types,AsyncMock
from motor.motor_asyncio import AsyncIOMotorClient
class MongoTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  if os.environ.get('CI')!='true':self.skipTest('Only runs in disposable CI Mongo service')
  self.client=AsyncIOMotorClient('mongodb://127.0.0.1:27017',serverSelectionTimeoutMS=3000)
  self.database=self.client.paneltec_reset_synthetic_fixture
  reset.db=self.database
  for n in [*reset.TARGETS,'users','test_reset_archive','test_reset_jobs','audit_log']:
   await self.database[n].delete_many({})
  self.user={'id':'synthetic-admin','org_id':'synthetic-a'}
  self.app=types.SimpleNamespace(state=types.SimpleNamespace(create_paneltec_snapshot=AsyncMock(return_value={'ok':True,'snapshot_id':'synthetic','sha256':'abc'})))
 async def asyncTearDown(self):self.client.close()
 async def test_actual_mongo_equality_archive_and_org_isolation(self):
  await self.database.pre_starts.insert_many([{'_id':'a','org_id':'synthetic-a','nested':{'hours':0}},{'_id':'b','org_id':'synthetic-b'}])
  await self.database.users.insert_one({'_id':'admin','org_id':'synthetic-a'})
  await reset.run_reset(self.app,self.user,'synthetic-job')
  self.assertIsNone(await self.database.pre_starts.find_one({'_id':'a'}))
  self.assertIsNotNone(await self.database.pre_starts.find_one({'_id':'b'}))
  self.assertEqual(await self.database.users.count_documents({}),1)
  self.assertEqual(await self.database.test_reset_archive.count_documents({}),1)
 async def test_actual_mongo_changed_document_not_deleted(self):
  old={'_id':'a','org_id':'synthetic-a','value':1}
  await self.database.pre_starts.insert_one(dict(old))
  await self.database.pre_starts.update_one({'_id':'a'},{'$set':{'value':2}})
  result=await self.database.pre_starts.delete_one({'_id':'a','org_id':'synthetic-a','$expr':{'$eq':['$$ROOT',{'$literal':old}]}})
  self.assertEqual(result.deleted_count,0)
if __name__=='__main__':unittest.main()
