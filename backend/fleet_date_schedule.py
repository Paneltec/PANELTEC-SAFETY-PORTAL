"""v58.13.122c — Date-anchor service scheduling for non-metered assets.

Trailers, tools, containers and any other kind that lacks km/hours
telemetry can now carry a **calendar-day** service interval on the
asset itself:

    assets.service_interval_days     int, nullable
    assets.service_last_done_date    str (ISO date), nullable

The register hydration path calls `compute_date_schedule` per row and
attaches a `date_schedule` block:

    date_schedule: {
        "interval_days":     180 | null,
        "last_done":         "2026-04-01" | null,
        "next_due":          "2026-09-28" | null,
        "days_remaining":    18 | null,
        "status": "on_schedule" | "due_soon" | "overdue" | "no_schedule",
    }

`status`:
    · "no_schedule"  →  interval_days is null (nothing to compute)
    · "overdue"      →  days_remaining < 0
    · "due_soon"     →  0 ≤ days_remaining ≤ 30
    · "on_schedule"  →  days_remaining > 30

Kept intentionally small so it can be unit-tested without touching
Mongo — the register-side integration lives in `fleet.py`.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional


# Kinds that get the date-schedule pill on the register + the drawer
# section. Everything else stays on the km/hours schedule path.
DATE_ANCHOR_KINDS: frozenset[str] = frozenset({"trailer", "tool", "container"})

DUE_SOON_WINDOW_DAYS = 30


@dataclass
class DateSchedule:
    interval_days: Optional[int]
    last_done: Optional[str]
    next_due: Optional[str]
    days_remaining: Optional[int]
    status: str  # "on_schedule" | "due_soon" | "overdue" | "no_schedule"

    def to_dict(self) -> dict:
        return {
            "interval_days": self.interval_days,
            "last_done": self.last_done,
            "next_due": self.next_due,
            "days_remaining": self.days_remaining,
            "status": self.status,
        }


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def compute_date_schedule(
    *,
    kind: Optional[str],
    interval_days: Optional[int],
    last_done_date: Optional[str],
    today: Optional[date] = None,
) -> Optional[DateSchedule]:
    """Return a `DateSchedule` for a date-anchored asset, or `None`
    when the asset kind is metered (km/hours-scheduled).

    Returns `status="no_schedule"` when `interval_days` is null so the
    frontend can render a placeholder pill instead of hiding.
    """
    if kind not in DATE_ANCHOR_KINDS:
        return None
    today = today or datetime.now().date()

    if not interval_days or interval_days <= 0:
        return DateSchedule(
            interval_days=None, last_done=None, next_due=None,
            days_remaining=None, status="no_schedule",
        )

    last_done = _parse_date(last_done_date)
    if last_done is None:
        # Interval set but no PM ever recorded → treat as overdue
        # (asset has never been serviced but should be on a schedule).
        return DateSchedule(
            interval_days=int(interval_days), last_done=None,
            next_due=None, days_remaining=None, status="overdue",
        )

    next_due = last_done + timedelta(days=int(interval_days))
    days_remaining = (next_due - today).days

    if days_remaining < 0:
        status = "overdue"
    elif days_remaining <= DUE_SOON_WINDOW_DAYS:
        status = "due_soon"
    else:
        status = "on_schedule"

    return DateSchedule(
        interval_days=int(interval_days),
        last_done=last_done.isoformat(),
        next_due=next_due.isoformat(),
        days_remaining=days_remaining,
        status=status,
    )


def is_date_anchor_kind(kind: Optional[str]) -> bool:
    """Public predicate — used by the log-service handler to decide
    whether to bump `service_last_done_date` on the asset row."""
    return kind in DATE_ANCHOR_KINDS
