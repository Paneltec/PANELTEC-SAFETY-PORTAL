import asyncio
from fastapi import HTTPException
from test_payroll_api import PayrollAPITests,client
class WorkTypeTests(PayrollAPITests):
    url='/payroll/employee-records/configuration/work-types'
    def test_defaults_and_revision_permissions(self):
        data=client.get(self.url,headers={'x-role':'editor'}).json()
        self.assertTrue(any(i['name']=='Traffic Control' for i in data['items']))
        data['items'][0]['name']='Call Out Updated'
        self.assertEqual(client.put(self.url,json=data,headers={'x-role':'viewer'}).status_code,403)
        self.assertEqual(client.put(self.url,json=data,headers={'x-role':'editor'}).status_code,200)
        self.assertEqual(client.put(self.url,json=data,headers={'x-role':'editor'}).status_code,409)
    def test_time_types_preserve_history_and_reject_leave_or_invalid_ids(self):
        from payroll_work_types import resolve_type,choices
        self.assertEqual(asyncio.run(resolve_type('org1','traffic-control',{})),'Traffic Control')
        self.assertFalse(any(i['action']!='primary' for i in asyncio.run(choices('org1'))))
        for identity in ['missing','annual-leave']:
            with self.assertRaises(HTTPException):asyncio.run(resolve_type('org1',identity,{}))
        self.assertEqual(asyncio.run(resolve_type('org1','archived',{'work_type_id':'archived','work_type_name':'Previous name'})),'Previous name')
