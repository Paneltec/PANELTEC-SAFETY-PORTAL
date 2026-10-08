"""Synthetic flow-chart persistence, organisation boundaries and stale edits."""
import unittest
from fastapi import HTTPException
from pydantic import ValidationError
from test_payroll_api import db, Collection
import program_schematic_overlays as flow

class FlowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        db.payroll_flow_documents = Collection()
        self.admin = {'id': 'admin-a', 'org_id': 'a', 'role': 'admin'}
        self.steps = [{'id': 'phone', 'title': 'Submit hours', 'area': 'Phone app'},
                      {'id': 'office', 'title': 'Approve hours', 'area': 'Office portal'}]

    async def test_save_edit_reorder_and_reload(self):
        self.assertIsNone((await flow.get_payroll_flow(self.admin))['steps'])
        saved = await flow.save_payroll_flow(flow.PayrollFlowSave(revision=0, steps=self.steps), self.admin)
        self.assertEqual(saved['revision'], 1)
        self.steps.reverse()
        self.steps[0]['status'] = 'Working'
        await flow.save_payroll_flow(flow.PayrollFlowSave(revision=1, steps=self.steps), self.admin)
        loaded = await flow.get_payroll_flow(self.admin)
        self.assertEqual(loaded['steps'][0]['id'], 'office')
        self.assertEqual(loaded['steps'][0]['status'], 'Working')

    async def test_org_isolation_and_conflicts(self):
        body = flow.PayrollFlowSave(revision=0, steps=self.steps)
        await flow.save_payroll_flow(body, self.admin)
        other = {**self.admin, 'org_id': 'b'}
        self.assertIsNone((await flow.get_payroll_flow(other))['steps'])
        await flow.save_payroll_flow(body, other)
        with self.assertRaises(HTTPException) as ctx:
            await flow.save_payroll_flow(body, self.admin)
        self.assertEqual(ctx.exception.status_code, 409)
        with self.assertRaises(HTTPException) as ctx:
            await flow.save_payroll_flow(flow.PayrollFlowSave(revision=9, steps=[]), self.admin)
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_admin_only(self):
        actor = {**self.admin, 'role': 'worker'}
        with self.assertRaises(HTTPException) as ctx:
            await flow.get_payroll_flow(actor)
        self.assertEqual(ctx.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            await flow.save_payroll_flow(flow.PayrollFlowSave(revision=0, steps=[]), actor)

    async def test_validation(self):
        with self.assertRaises(ValidationError):
            flow.PayrollFlowSave(revision=0, steps=[{**self.steps[0], 'status': 'invented'}])
        for steps in ([self.steps[0], self.steps[0]], [{**self.steps[0], 'link': 'https://example.com'}]):
            with self.assertRaises(HTTPException) as ctx:
                await flow.save_payroll_flow(flow.PayrollFlowSave(revision=0, steps=steps), self.admin)
            self.assertEqual(ctx.exception.status_code, 422)

if __name__ == '__main__': unittest.main()
