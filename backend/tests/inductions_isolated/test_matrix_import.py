"""Synthetic workbook tests. No database connection or real employee data."""
import sys, types, io, unittest
from pathlib import Path
from unittest.mock import AsyncMock
from datetime import datetime
import openpyxl
from fastapi import HTTPException, UploadFile
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
async def user(): return {}
for name, attrs in {'db': {'db': None}, 'auth': {'get_current_user': user}, 'permissions': {'require_permission': lambda *a: user}}.items():
    mod=types.ModuleType(name); mod.__dict__.update(attrs); sys.modules[name]=mod
import workers_inductions as m
class Cursor:
    def __init__(self, rows): self.rows=iter(rows)
    def __aiter__(self): return self
    async def __anext__(self):
        try: return next(self.rows)
        except StopIteration: raise StopAsyncIteration
class Workers:
    def __init__(self, rows): self.rows=rows
    def find(self, query, *args): return Cursor([r for r in self.rows if r['org_id']==query['org_id']])
    async def find_one(self,q): return next((r for r in self.rows if r['id']==q['id'] and r['org_id']==q['org_id']),None)
def workbook(split=True):
    w=openpyxl.Workbook();s=w.active
    s.append(['Training Matrix']);s.append(['Date created',None,'Current','Expired','Lapsed'])
    s.append(['First name','Last name','Site induction','Empty induction'] if split else ['Worker','Site induction'])
    s.append(['Test','Person',datetime(2027,1,2),None] if split else ['Test Person',datetime(2027,1,2)])
    f=io.BytesIO();w.save(f);return f.getvalue()
class Tests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user={'id':'admin','org_id':'a','role':'admin'}
        self.rows=[{'id':'w','org_id':'a','first_name':'Test','last_name':'Person'}]
        m.db=types.SimpleNamespace(workers=Workers(self.rows),worker_certifications=types.SimpleNamespace(find_one=AsyncMock(return_value=None),insert_one=AsyncMock(),update_one=AsyncMock()),induction_matrix_columns=types.SimpleNamespace(update_one=AsyncMock()))
    async def test_split_name_legend_dates_and_empty_column(self):
        p=await m.preview_workbook(workbook(),self.user)
        self.assertEqual(p['summary']['matched_workers'],1);self.assertEqual(p['summary']['induction_columns'],2)
        self.assertEqual(p['inductions']['matched_rows'][0]['cells'][0]['date'],'2027-01-02')
        self.assertEqual(p['inductions']['matched_rows'][0]['cells'][1]['date'],None)
        self.assertEqual(p['summary']['low_confidence_cells'],0)
    async def test_legacy_single_name(self):
        self.assertEqual((await m.preview_workbook(workbook(False),self.user))['summary']['matched_workers'],1)
    async def test_duplicate_name_is_unmatched(self):
        self.rows.append({**self.rows[0],'id':'duplicate'})
        self.assertEqual((await m.preview_workbook(workbook(),self.user))['summary']['unmatched_workers'],1)
    async def test_other_org_not_matched(self):
        self.rows[0]['org_id']='b'
        self.assertEqual((await m.preview_workbook(workbook(),self.user))['summary']['matched_workers'],0)
    async def test_invalid_file(self):
        with self.assertRaises(HTTPException):await m.preview_workbook(b'not excel',self.user)
    async def test_upload_and_role(self):
        p=await m.import_xlsx_upload(UploadFile(filename='matrix.xlsx',file=io.BytesIO(workbook())),self.user)
        self.assertEqual(p['summary']['matched_workers'],1)
        with self.assertRaises(HTTPException):await m.import_xlsx_upload(UploadFile(filename='matrix.xlsx',file=io.BytesIO(workbook())),{**self.user,'role':'worker'})
    def body(self,**cell):
        return m.CommitIn(inductions=[{'worker_id':'w','cells':[{'column_key':'site','header':'Site','category':'site_induction',**cell}]}])
    async def test_blank_and_low_confidence_skipped(self):
        for cell in [{},{'date':'2027-01-02','confidence':'low'}]:
            self.assertEqual((await m.import_xlsx_commit(self.body(**cell),self.user))['certifications']['skipped'],1)
        m.db.worker_certifications.insert_one.assert_not_awaited()
    async def test_later_existing_date_preserved(self):
        m.db.worker_certifications.find_one.return_value={'id':'c','expiry_date':'2028-01-01'}
        self.assertEqual((await m.import_xlsx_commit(self.body(date='2027-01-02'),self.user))['certifications']['newer_preserved'],1)
        m.db.worker_certifications.update_one.assert_not_awaited()
    async def test_wrong_worker_rejected_before_writes(self):
        self.rows[0]['org_id']='b'
        with self.assertRaises(HTTPException):await m.import_xlsx_commit(self.body(date='2027-01-02'),self.user)
        m.db.worker_certifications.insert_one.assert_not_awaited()
    async def test_columns_saved_without_false_certifications(self):
        body=m.CommitIn(columns=[{'column_key':'empty','header':'Empty','category':'site_induction'}])
        await m.import_xlsx_commit(body,self.user)
        m.db.induction_matrix_columns.update_one.assert_awaited_once()
        m.db.worker_certifications.insert_one.assert_not_awaited()
if __name__=='__main__':unittest.main()
