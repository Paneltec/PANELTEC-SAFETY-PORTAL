"""Phase 3.16 Part A regression — `last_activity_at` normalisation.

Belt-and-suspenders cover for the BSON-Date silent-fail.

Pre-Phase 3.16, `touch_and_check_session()` only handled `last_activity_at`
when it was an ISO string. If a future migration / older write path landed a
genuine `datetime` (BSON Date) in the doc, the function fell through to
`last = None` and — because of an `except Exception: last = None` swallow —
silently *kept the session alive forever*. That's a fail-OPEN security bug.

These tests pin down the new helper `_normalise_activity_ts` to make sure:
  1. ISO strings parse and end up tz-aware UTC.
  2. Naive datetime inputs are treated as UTC (not local).
  3. Tz-aware datetime inputs round-trip unchanged.
  4. Malformed strings → `None` (caller treats as expired = fail-SAFE).
  5. None / weird types → `None`.

The async DB-touching code (`touch_and_check_session`) is exercised by the
existing curl-based integration tests; here we just nail the pure parsing
contract so the regression can't sneak back in.
"""
from datetime import datetime, timedelta, timezone

from session_timeout import _normalise_activity_ts


# ─────────── 1. ISO string inputs ───────────

def test_iso_string_with_offset():
    out = _normalise_activity_ts("2026-06-29T04:50:00+00:00")
    assert out == datetime(2026, 6, 29, 4, 50, 0, tzinfo=timezone.utc)
    assert out.tzinfo is not None


def test_iso_string_with_trailing_Z():
    """The legacy Mongo write path emits `…Z` instead of `…+00:00`."""
    out = _normalise_activity_ts("2026-06-29T04:50:00Z")
    assert out == datetime(2026, 6, 29, 4, 50, 0, tzinfo=timezone.utc)


def test_iso_string_naive_is_stamped_utc():
    """A timestamp written without `tzinfo` must be assumed UTC, not local."""
    out = _normalise_activity_ts("2026-06-29T04:50:00")
    assert out.tzinfo is not None
    assert out.utcoffset() == timedelta(0)


# ─────────── 2. datetime inputs (the BSON-Date path) ───────────

def test_datetime_tz_aware_roundtrip():
    src = datetime(2026, 6, 29, 4, 50, 0, tzinfo=timezone.utc)
    out = _normalise_activity_ts(src)
    assert out == src
    assert out.tzinfo is timezone.utc


def test_datetime_naive_is_stamped_utc():
    """Motor sometimes hands back naive datetimes when `tz_aware=False` —
    the helper MUST upgrade them to tz-aware so the subsequent subtract
    against `datetime.now(timezone.utc)` doesn't raise TypeError."""
    src = datetime(2026, 6, 29, 4, 50, 0)
    out = _normalise_activity_ts(src)
    assert out is not None
    assert out.tzinfo is not None
    assert out.utcoffset() == timedelta(0)
    # Same wall-clock moment, just stamped.
    assert out.replace(tzinfo=None) == src


def test_two_hour_old_datetime_is_parseable_and_idle():
    """End-to-end shape: an idle-2h activity should normalise to a delta
    that the caller can compare against `idle_minutes * 60` seconds."""
    two_h_ago = datetime.now(timezone.utc) - timedelta(hours=2)
    out = _normalise_activity_ts(two_h_ago)
    assert out is not None
    age_s = (datetime.now(timezone.utc) - out).total_seconds()
    assert 7100 < age_s < 7300  # ~7200s = 2h


# ─────────── 3. Failure modes (must fail SAFE = return None) ───────────

def test_malformed_string_returns_none():
    """A garbage string → None → caller treats as expired = fail-SAFE."""
    assert _normalise_activity_ts("not-a-date") is None
    assert _normalise_activity_ts("") is None
    assert _normalise_activity_ts("2026-13-99T99:99:99") is None


def test_none_returns_none():
    assert _normalise_activity_ts(None) is None


def test_unknown_type_returns_none():
    """An int (epoch?) or dict isn't supported — must NOT crash, must NOT
    silently keep the session alive."""
    assert _normalise_activity_ts(0) is None
    assert _normalise_activity_ts(1719634200) is None
    assert _normalise_activity_ts({"$date": "2026-06-29T04:50:00Z"}) is None
    assert _normalise_activity_ts([2026, 6, 29]) is None
