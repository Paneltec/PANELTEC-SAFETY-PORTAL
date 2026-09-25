"""v160.3.8.1 — Server-side registry for the Settings sub-nav.

Single source of truth for the ``key`` field stored in
``settings_nav_layout``. If a payload arrives referencing a key that
isn't in this list the ``PUT /api/settings/nav-layout`` endpoint
rejects it with a 400 — this prevents a client-side typo (or a
malicious payload) from silently persisting garbage that the
frontend can't render.

The mirror lives at ``frontend/src/lib/settingsNavRegistry.js`` — the
label/route/icon set is duplicated there so the sidebar can render
without a round-trip. Backend never invents new keys; adding a new
setting page means editing BOTH files. The list here intentionally
stays terse (key + label + route + admin_only + resource) — the
icon-name mapping is a frontend concern.
"""
from __future__ import annotations

from typing import Any

SETTINGS_NAV_ITEMS: list[dict[str, Any]] = [
    {"key": "organisation",       "label": "Organisation",         "route": "/app/settings/org",                  "admin_only": False, "resource": None},
    # v58.13.132cb — `workspaces` key kept in the registry (NOT retired
    # server-side yet) so pre-.132cb saved nav-layouts still validate
    # on `PUT /api/settings/nav-layout`. The frontend registry drops
    # the entry, so SettingsNav filters it out visually. Phase B
    # (.132cb-b) will remove this key + reject it from future layouts.
    {"key": "workspaces",         "label": "Workspaces",           "route": "/app/settings/workspaces",           "admin_only": False, "resource": None},
    {"key": "users_permissions",  "label": "Users & Permissions",  "route": "/app/settings/users",                "admin_only": True,  "resource": None},
    {"key": "permission_presets", "label": "Permission presets",   "route": "/app/settings/permission-presets",   "admin_only": True,  "resource": None},
    # v160.3.9.31-4a — Phase 4a: Roles Admin page.
    {"key": "roles_admin",        "label": "Roles Admin",          "route": "/app/settings/roles-admin",          "admin_only": True,  "resource": None},
    {"key": "workers",            "label": "Workers",              "route": "/app/settings/workers",              "admin_only": False, "resource": None},
    # v160.3.9.48 — HR Employees register. Permission-gated via `hr_employees.view`.
    {"key": "hr_employees",       "label": "HR Employees",         "route": "/app/settings/hr-employees",         "admin_only": True,  "resource": "hr_employees"},
    {"key": "form_assignments",   "label": "Form Assignments",     "route": "/app/settings/form-assignments",     "admin_only": True,  "resource": None},
    {"key": "swms_assignments",   "label": "SWMS Assignments",     "route": "/app/settings/swms-assignments",     "admin_only": True,  "resource": None},
    {"key": "integrations",       "label": "Integrations",         "route": "/app/settings/integrations",         "admin_only": False, "resource": "integrations"},
    {"key": "system",             "label": "System",               "route": "/app/settings/system",               "admin_only": True,  "resource": None},
    {"key": "certifications",     "label": "Certifications",       "route": "/app/settings/certifications",       "admin_only": False, "resource": None},
    {"key": "backup_restore",     "label": "Backup & Restore",     "route": "/app/settings/backup",               "admin_only": True,  "resource": None},
    {"key": "program_schematic",  "label": "Program Schematic",    "route": "/app/settings/schematic",            "admin_only": True,  "resource": None},
    {"key": "email_outbox",       "label": "Email outbox",         "route": "/app/outbox",                        "admin_only": False, "resource": None},
    {"key": "user_manual",        "label": "User Manual",          "route": "/app/help",                          "admin_only": False, "resource": None},
    # v58.13.132mz — Standalone "Phone Preview" entry. Gated by the
    # dedicated `mobile_preview` resource (see `permissions.py`).
    # Placement: last in the registry — consumers slot it into the
    # Settings sub-nav via `default_layout()`; existing per-org
    # layouts persist unchanged and will surface the entry only
    # after an admin explicitly adds it via the drag/drop tray.
    {"key": "phone_preview",      "label": "Phone Preview",        "route": "/app/phone-preview",                 "admin_only": False, "resource": "mobile_preview"},
]

SETTINGS_NAV_KEYS: set[str] = {it["key"] for it in SETTINGS_NAV_ITEMS}


def default_layout() -> list[dict[str, Any]]:
    """Fresh-org seed. Admin folder pins the three highest-privilege
    surfaces (Users & Permissions / Backup / Program Schematic); every
    other item drops at root in the registered order.
    """
    admin_keys = {"users_permissions", "backup_restore", "program_schematic"}
    root: list[dict[str, Any]] = []
    for it in SETTINGS_NAV_ITEMS:
        if it["key"] in admin_keys:
            continue
        root.append({"type": "item", "key": it["key"]})
    # Splice the Admin folder in after the first two items so it
    # doesn't dominate the top of the list.
    admin_folder = {
        "type": "folder",
        "id": "folder_admin",
        "label": "Admin",
        "children": [
            {"type": "item", "key": "users_permissions"},
            {"type": "item", "key": "backup_restore"},
            {"type": "item", "key": "program_schematic"},
        ],
    }
    root.insert(2, admin_folder)
    return root
