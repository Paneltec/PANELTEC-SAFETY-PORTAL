"""Exercise the actual payroll-access HTTP handler with synthetic identities."""
import test_payroll_api as fixture
import ast, os, unittest
from unittest.mock import patch
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header
from fastapi.testclient import TestClient
from pydantic import BaseModel
from payroll_access import is_payroll_owner
source=(Path(__file__).resolve().parents[2]/'users.py').read_text(encoding='utf-8')
tree=ast.parse(source)
selected=[n for n in tree.body if isinstance(n,(ast.ClassDef,ast.AsyncFunctionDef)) and n.name in ('PayrollAccessIn','set_payroll_access')]
async def actor(x_actor: str=Header(default='other')):
    return {'id':x_actor,'org_id':'org-a','role':'admin'}
ns=dict(APIRouter=APIRouter,BaseModel=BaseModel,Literal=Literal,Depends=Depends,HTTPException=HTTPException,get_current_user=actor,is_payroll_owner=is_payroll_owner,db=fixture.db,now_iso=lambda:'2026-10-06',router=APIRouter())
exec(compile(ast.Module(body=selected,type_ignores=[]),'users.py','exec'),ns)
app=FastAPI();app.include_router(ns['router']);client=TestClient(app)
class OwnerAccessTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'PAYROLL_OWNER_USER_ID':'owner','PAYROLL_OWNER_ORG_ID':'org-a'});self.env.start()
        fixture.db.users=fixture.Collection();fixture.db.payroll_access=fixture.Collection()
        fixture.db.users.rows=[{'id':'admin2','org_id':'org-a','role':'admin'},{'id':'worker','org_id':'org-a','role':'worker'},{'id':'foreign','org_id':'org-b','role':'admin'},{'id':'owner','org_id':'org-a','role':'admin'}]
    def tearDown(self):self.env.stop()
    def put(self,target,level,who='owner'):
        return client.put('/'+target+'/payroll-access',json={'level':level},headers={'x-actor':who})
    def test_other_admin_cannot_grant(self):self.assertEqual(self.put('admin2','edit','other').status_code,403)
    def test_owner_grants_and_revokes(self):
        self.assertEqual(self.put('admin2','edit').status_code,200)
        self.assertEqual(fixture.db.payroll_access.rows[0]['level'],'edit')
        self.assertEqual(self.put('admin2','none').status_code,200)
        self.assertEqual(fixture.db.payroll_access.rows[0]['level'],'none')
    def test_foreign_org_blocked(self):self.assertEqual(self.put('foreign','view').status_code,404)
    def test_worker_cannot_be_granted(self):self.assertEqual(self.put('worker','edit').status_code,400)
    def test_owner_cannot_be_removed(self):self.assertEqual(self.put('owner','none').status_code,400)
    def test_invalid_level(self):self.assertEqual(self.put('admin2','superuser').status_code,422)
if __name__=='__main__':unittest.main()
