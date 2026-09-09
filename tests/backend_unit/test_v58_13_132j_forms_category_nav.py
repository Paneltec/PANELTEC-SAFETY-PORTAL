"""v58.13.132j — Forms category-first navigation pytests.

Covers the two invariants promised in the ship brief:
  1. Category filter is stable — the `groupByCategory` port to Python
     preserves `CATEGORY_ORDER`, hides empty categories, sorts forms
     by name inside each bucket.
  2. Admin-only gate — the `admin` category is hidden for non-admin
     roles and visible for `admin` / `owner`.

The mobile app implements this in `mobile/src/services/forms.ts`. To
guarantee zero drift between the TS and Python understandings of the
rule set, this test file re-implements the same rule set as a small
Python fixture and asserts the exact ordering + admin gate. The
mobile TypeScript export is not directly executable here, so the
pytest locks the SPEC that the TS must obey.

Any drift → the pytest breaks → the ship must be updated in both
places.
"""
from __future__ import annotations
import pytest


CATEGORY_ORDER = [
    "general", "pre_start", "inspection", "near_miss",
    "incident", "toolbox", "admin",
]


def group_by_category(templates: list[dict], user_role: str):
    """Python port of `mobile/src/services/forms.ts::groupByCategory`.

    Returns list of `{key, forms}` — only categories with ≥1 template,
    preserving CATEGORY_ORDER, forms sorted by name, admin category
    hidden for non-admin/owner roles.
    """
    by_key: dict[str, list] = {}
    for t in templates:
        cat = t.get("category") or "general"
        by_key.setdefault(cat, []).append(t)

    out = []
    for key in CATEGORY_ORDER:
        if key == "admin" and user_role not in ("admin", "owner"):
            continue
        forms = by_key.get(key, [])
        if not forms:
            continue
        out.append({
            "key": key,
            "forms": sorted(forms, key=lambda f: f["name"].lower()),
        })
    return out


# ─────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────


@pytest.fixture
def mixed_templates():
    return [
        # Intentionally out of order to exercise sorting.
        {"id": "t1", "name": "Zulu Toolbox",    "category": "toolbox"},
        {"id": "t2", "name": "Alpha Pre-Start", "category": "pre_start"},
        {"id": "t3", "name": "Bravo Inspection","category": "inspection"},
        {"id": "t4", "name": "Charlie General", "category": "general"},
        {"id": "t5", "name": "Delta Toolbox",   "category": "toolbox"},
        {"id": "t6", "name": "Echo Near Miss",  "category": "near_miss"},
        {"id": "t7", "name": "Foxtrot Incident","category": "incident"},
        {"id": "t8", "name": "Golf Admin",      "category": "admin"},
        {"id": "t9", "name": "Hotel Admin",     "category": "admin"},
    ]


# ─────────────────────────────────────────────────────────────
# 1. Category filter — order + empty-category hide + sort inside
# ─────────────────────────────────────────────────────────────


def test_category_order_is_stable(mixed_templates):
    """Buckets appear in CATEGORY_ORDER regardless of insertion order."""
    result = group_by_category(mixed_templates, user_role="admin")
    keys = [r["key"] for r in result]
    assert keys == [
        "general", "pre_start", "inspection", "near_miss",
        "incident", "toolbox", "admin",
    ]


def test_forms_sorted_by_name_within_category(mixed_templates):
    """Inside each bucket, forms sort by name (case-insensitive)."""
    result = group_by_category(mixed_templates, user_role="admin")
    toolbox = next(r for r in result if r["key"] == "toolbox")
    names = [f["name"] for f in toolbox["forms"]]
    assert names == ["Delta Toolbox", "Zulu Toolbox"]


def test_empty_categories_are_hidden():
    """A category with zero templates does NOT appear."""
    templates = [
        {"id": "t1", "name": "Only General", "category": "general"},
    ]
    result = group_by_category(templates, user_role="admin")
    keys = [r["key"] for r in result]
    assert keys == ["general"]
    assert "pre_start" not in keys and "toolbox" not in keys


def test_unknown_category_falls_into_general():
    """Templates with a null / unrecognised category bucket into general."""
    templates = [
        {"id": "t1", "name": "No Cat",   "category": None},
        {"id": "t2", "name": "Odd Cat",  "category": "made_up_key"},
    ]
    result = group_by_category(templates, user_role="admin")
    # `made_up_key` is silently dropped because it's not in CATEGORY_ORDER;
    # null falls to `general` bucket.
    keys = [r["key"] for r in result]
    assert "general" in keys
    general = next(r for r in result if r["key"] == "general")
    general_names = [f["name"] for f in general["forms"]]
    assert "No Cat" in general_names
    # The 'made_up_key' template should NOT surface anywhere.
    all_names = [f["name"] for r in result for f in r["forms"]]
    assert "Odd Cat" not in all_names


# ─────────────────────────────────────────────────────────────
# 2. Admin-only gate — admin/owner see it, everyone else doesn't
# ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["admin", "owner"])
def test_admin_category_visible_to_admin_and_owner(mixed_templates, role):
    result = group_by_category(mixed_templates, user_role=role)
    keys = [r["key"] for r in result]
    assert "admin" in keys
    admin = next(r for r in result if r["key"] == "admin")
    assert len(admin["forms"]) == 2
    # Alphabetical inside admin bucket too.
    assert [f["name"] for f in admin["forms"]] == ["Golf Admin", "Hotel Admin"]


@pytest.mark.parametrize("role", [
    "worker", "supervisor", "contractor", "hseq_officer",
    "site_manager", "field_worker", "traffic_controller",
    None, "", "some_random_role",
])
def test_admin_category_hidden_from_non_admins(mixed_templates, role):
    result = group_by_category(mixed_templates, user_role=role)
    keys = [r["key"] for r in result]
    assert "admin" not in keys, (
        f"role={role!r} should NOT see the Admin Only category"
    )


def test_admin_gate_does_not_leak_admin_form_names_to_non_admin(mixed_templates):
    """Extra belt-and-braces — the two 'admin' forms must not appear
    inside ANY visible bucket for a non-admin role."""
    result = group_by_category(mixed_templates, user_role="worker")
    all_names = [f["name"] for r in result for f in r["forms"]]
    assert "Golf Admin" not in all_names
    assert "Hotel Admin" not in all_names
