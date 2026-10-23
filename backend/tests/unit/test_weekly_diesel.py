"""Offline pricing regressions: no network, database or production account access."""
import asyncio
import copy
import importlib.util
from datetime import date, timedelta
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch, AsyncMock

ROOT = Path(__file__).resolve().parents[2]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {
        "db": types.SimpleNamespace(db=None),
        "permissions": types.SimpleNamespace(require_permission=lambda *args: lambda: None),
        "auth": types.SimpleNamespace(get_current_user=lambda: None),
    }):
        spec.loader.exec_module(module)
    return module

weekly = load("weekly_test", "fuel_weekly_prices.py")
prices = load("price_test", "fuel_price_settings.py")

def payload(start=date(2026, 10, 12), rates=None):
    rates = rates or [287.9, 287.0, 286.3, 285.8, 285.3, 285.4, 285.4]
    return {"AveragePrices": [{"Code": "DL", "Period": "Month", "Captured": (start + timedelta(days=i)).isoformat(), "Price": rate} for i, rate in enumerate(rates)]}

class WeeklyTests(unittest.TestCase):
    def test_complete_week_and_cent_conversion(self):
        rows = weekly.build_weeks(payload(), date(2026, 10, 23))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["week_start"], "2026-10-19")
        self.assertEqual(rows[0]["price_per_litre"], 2.8616)
        self.assertEqual(len(rows[0]["daily_prices_cents"]), 7)

    def test_no_partial_or_current_week(self):
        self.assertEqual(weekly.build_weeks(payload(rates=[280] * 6), date(2026, 10, 23)), [])
        self.assertEqual(weekly.build_weeks(payload(), date(2026, 10, 18)), [])

    def test_not_premium_or_monthly_summary(self):
        data = payload()
        data["AveragePrices"] += [{"Code": "PDL", "Period": "Month", "Captured": "2026-10-12", "Price": 999}, {"Code": "DL", "Period": "Year", "Captured": "October 2026", "Price": 999}]
        self.assertEqual(weekly.build_weeks(data, date(2026, 10, 23))[0]["price_per_litre"], 2.8616)

    def test_bad_and_conflicting_data(self):
        for value in [float('nan'), -1, 1001]:
            with self.assertRaises(ValueError): weekly.build_weeks(payload(rates=[value]*7), date(2026,10,23))
        data = payload(); data["AveragePrices"].append({**data["AveragePrices"][0], "Price": 300})
        with self.assertRaises(ValueError): weekly.build_weeks(data, date(2026,10,23))

    def test_hobart_midnight_and_dst(self):
        self.assertEqual(weekly.week_start("2026-10-18T12:59:59Z"), date(2026,10,12))
        self.assertEqual(weekly.week_start("2026-10-18T13:00:00Z"), date(2026,10,19))
        self.assertEqual(weekly.week_start("2026-10-04T13:00:00Z"), date(2026,10,5))

    def test_existing_frozen_cost_ignores_current_price(self):
        for override in [True, False]:
            self.assertEqual(prices.effective_total_price({"frozen_at": "then", "frozen_total_price": 123.45, "litres": 100, "total_price": 900}, 7, override), 123.45)

    def test_delayed_import_uses_fill_week_and_metadata(self):
        async def run():
            snap = weekly.build_weeks(payload(), date(2026,10,23))[0]
            with patch.object(weekly, "weekly_snapshot", AsyncMock(return_value=snap)) as lookup, patch.dict(sys.modules, {"fuel_price_settings": prices}):
                result = await weekly.freeze_for_import({"timestamp": "2026-10-20T00:00:00Z", "litres": 100, "total_price": 999, "fuel_type": "Diesel"}, {"weekly_diesel_enabled": True, "weekly_diesel_start": "2026-10-19"}, 2.8, True, "manual", {})
                lookup.assert_awaited_once_with(date(2026,10,19))
                self.assertEqual(result["frozen_price_per_litre"], 2.8616)
                self.assertEqual(result["frozen_total_price"], 286.16)
                self.assertEqual(result["frozen_price_source"], "fuelcheck_weekly_diesel")
        asyncio.run(run())

    def test_missing_week_does_not_guess_price(self):
        async def run():
            with patch.object(weekly, "weekly_snapshot", AsyncMock(return_value=None)), patch.object(weekly, "refresh_prices", AsyncMock()), patch.dict(sys.modules, {"fuel_price_settings": prices}):
                with self.assertRaisesRegex(ValueError, "pending"):
                    await weekly.freeze_for_import({"timestamp":"2026-10-20T00:00:00Z", "litres":100}, {"weekly_diesel_enabled": True, "weekly_diesel_start":"2026-10-19"}, 2.8, True, None, {})
        asyncio.run(run())

    def test_non_diesel_and_pre_activation_use_original_policy(self):
        async def run():
            with patch.dict(sys.modules, {"fuel_price_settings": prices}):
                for fuel, timestamp in [("U91", "2026-10-20T00:00:00Z"), ("Diesel", "2026-10-10T00:00:00Z")]:
                    snap = await weekly.freeze_for_import({"timestamp": timestamp, "fuel_type":fuel, "litres":100}, {"weekly_diesel_enabled":True, "weekly_diesel_start":"2026-10-19"}, 2.8, True, None, {})
                    self.assertEqual(snap["frozen_total_price"], 280)
        asyncio.run(run())

    def test_refresh_cannot_overwrite_locked_week(self):
        stored = {}
        class Collection:
            async def update_one(self, query, update, upsert):
                stored.setdefault(query["_id"], copy.deepcopy(update["$setOnInsert"]))
        class Response:
            def raise_for_status(self): pass
            def json(self): return payload()
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs): return Response()
        async def run():
            with patch.object(weekly, "db", types.SimpleNamespace(fuel_weekly_prices=Collection())), patch.object(weekly.httpx, "AsyncClient", Client):
                await weekly.refresh_prices()
                before = copy.deepcopy(stored)
                with patch.object(Response, "json", lambda self: payload(rates=[300]*7)):
                    await weekly.refresh_prices()
                self.assertTrue(before)
                self.assertEqual(stored, before)
        asyncio.run(run())

if __name__ == '__main__': unittest.main()
