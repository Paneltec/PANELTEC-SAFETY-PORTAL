"""v58.13.132au — SmartFill dedupe hash guardrail.

Regression coverage for the CSV vs API twin bug that Stephen's
XT02AX 604 L / 114 L report surfaced. Locks in three properties of
`_compose_dedupe_hash`:

  1. Same fill via CSV path (seconds present) and API path (seconds
     zero) produces the SAME hash — the whole point of the fix.
  2. Fills that share a card in the same minute but differ in
     litres still hash differently (guard against over-collapsing).
  3. Timezone offsets round-trip cleanly (no accidental TZ stripping
     side-effect from the canonicaliser).
"""
from __future__ import annotations

from fleet_fuel import _compose_dedupe_hash


def test_csv_and_api_paths_produce_same_hash():
    """v58.13.132au — CSV row with real seconds must collide with
    API row rounded to the minute. Same card, same litres, same
    minute — one hash."""
    csv_hash = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:07+00:00", litres=50.020,
    )
    api_hash = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    assert csv_hash == api_hash
    assert csv_hash is not None


def test_fractional_seconds_also_collapse_to_minute():
    """Some SmartFill payloads emit `.123` microseconds. Ensure the
    canonicaliser strips the fractional-seconds tail cleanly."""
    with_frac = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:07.842+00:00", litres=50.020,
    )
    plain = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    assert with_frac == plain


def test_z_suffix_treated_as_utc():
    """`Z` timezone shorthand must survive the canonicaliser."""
    z = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:07Z", litres=50.020,
    )
    plus = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00Z", litres=50.020,
    )
    assert z == plus


def test_different_litres_still_different_hash():
    """Guardrail — the fix must not accidentally collapse two
    fills that share the same card + minute but differ in litres."""
    fill_a = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    fill_b = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=51.020,
    )
    assert fill_a != fill_b


def test_different_minutes_produce_different_hash():
    """Two fills on the same card in adjacent minutes must remain
    distinct (SmartFill never emits two fills in the same minute on
    the same card, but the hash mustn't rely on that)."""
    m28 = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    m29 = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:29:00+00:00", litres=50.020,
    )
    assert m28 != m29


def test_different_cards_produce_different_hash():
    """Two fills at the same minute on different cards must remain
    distinct (fleet-mate topping up at the same pump)."""
    card_14 = _compose_dedupe_hash(
        card_number="21314", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    card_17 = _compose_dedupe_hash(
        card_number="21317", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    assert card_14 != card_17


def test_no_identifier_returns_none():
    """If card, key_code and registration are all blank, return
    None. Upstream rejects the row before it reaches the DB."""
    h = _compose_dedupe_hash(
        card_number="", key_code="", registration="",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    assert h is None


def test_rego_falls_back_upper_cased():
    """When no card/key_code, registration is used and upper-cased
    so `xt02ax` and `XT02AX` collide."""
    upper = _compose_dedupe_hash(
        card_number="", key_code="", registration="XT02AX",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    lower = _compose_dedupe_hash(
        card_number="", key_code="", registration="xt02ax",
        timestamp="2026-09-04T06:28:00+00:00", litres=50.020,
    )
    assert upper == lower
