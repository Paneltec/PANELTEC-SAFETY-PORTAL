"""v160.3.9.44 — Permissions-gate contract regression.

Static scan of `/app/backend/*.py` for the invariant:

    Every `@router.{post|put|patch|delete}` route must be gated by
    either `require_permission(...)` or `require_admin(...)` — either
    directly on the endpoint or transitively through a named wrapper
    (`Depends(require_ai_use)`, `Depends(require_admin_and_hseq)`, etc.).

The v160.3.9.43.2 audit ORIGINALLY flagged 10 unguarded mutating routes,
but a follow-up check showed 3 of them (in `ai.py`) were gated via the
aliased `Depends(require_ai_use)` — which itself is
`Depends(require_permission("ai", "use"))`. So the contract must
recognise aliased permission wrappers, not just literal
`require_permission(` substrings.

The remaining legitimate unguarded auth-bootstrap routes are allow-listed
by (file, path) — anything else that appears without a permission gate
is a contract violation and must be justified + added to the allow-list.
"""
from __future__ import annotations
import re
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent

# (file, verb, path) tuples for routes that must NOT have a permission
# gate because they are the auth/bootstrap layer.
_AUTH_BOOTSTRAP_ALLOWLIST = {
    ("auth.py", "post", "/signup"),
    ("auth.py", "post", "/login"),
    ("auth.py", "post", "/login-with-simpro"),
    ("auth_invite.py", "post", "/auth/invite/validate"),
    ("auth_invite.py", "post", "/auth/reset/redeem"),
    ("auth_invite.py", "post", "/auth/reset/validate"),
    ("auth_invite.py", "post", "/auth/pin/redeem"),
}

# Any `Depends(<name>)` where <name> ends in one of these suffixes is
# treated as a permission-alias wrapper. Extend this list when a new
# wrapper is added upstream of `require_permission`/`require_admin`.
_PERMISSION_WRAPPER_NAME_SUFFIXES = (
    "require_permission",
    "require_admin",
    "require_ai_use",
    "require_module",
    "require_authenticated_admin",
    "require_admin_and_hseq",
    "require_org_admin",
    "require_backup_admin",
    "require_integration_admin",
)

_ROUTE_RE = re.compile(
    r"@(?:app|router|bulk_router)\.(post|put|patch|delete)\("
    r"['\"]([^'\"]+)['\"]"
)
_DEPENDS_RE = re.compile(r"Depends\(([A-Za-z_][\w\.]*)\s*[\(,)]")


def _endpoint_gates(chunk: str) -> list[str]:
    """Return the list of `Depends(<name>)` callable names found in the
    chunk of source that follows a route decorator (up to the next
    decorator or ~2500 chars)."""
    return _DEPENDS_RE.findall(chunk)


def _is_permission_gate(name: str) -> bool:
    return any(name.endswith(sfx) for sfx in _PERMISSION_WRAPPER_NAME_SUFFIXES)


def _scan() -> list[tuple[str, str, str, list[str]]]:
    """Return every (file, verb, path, gates) for mutating routes."""
    out = []
    for p in sorted(_BACKEND.glob("*.py")):
        src = p.read_text(encoding="utf-8", errors="ignore")
        for m in _ROUTE_RE.finditer(src):
            verb = m.group(1)
            path = m.group(2)
            chunk = src[m.start(): m.start() + 2500]
            gates = _endpoint_gates(chunk)
            out.append((p.name, verb, path, gates))
    return out


# v160.3.9.44 — KNOWN LEGACY GAPS from the v43.2 RBAC audit (P3-113 finding).
# These 122 state-mutating routes currently use ONLY `Depends(get_current_user)`
# or `Depends(require_roles(...))` without a token-based permission gate. They
# will be migrated to `require_permission(...)` in a future wave. For now they
# are documented tech debt — the contract test still catches NEW additions
# outside this list, which is the primary CI-regression value.
_KNOWN_UNGATED_LEGACY = frozenset({
    ('admin_active_sessions.py', 'delete', '/active-sessions/{jti}'),
    ('admin_active_sessions.py', 'post', '/active-sessions/bulk-revoke'),
    ('admin_active_sessions.py', 'post', '/active-sessions/purge-inactive'),
    ('ask.py', 'post', '/suggestions'),
    ('ask.py', 'patch', '/suggestions/{suggestion_id}'),
    ('ask.py', 'delete', '/suggestions/{suggestion_id}'),
    ('asset_meter_history.py', 'post', '/{asset_id}/meter-history'),
    ('asset_navixy_sync.py', 'post', '/navixy/sync-counters'),
    ('asset_navixy_sync.py', 'post', '/navixy/repair-lifetimes'),
    ('asset_service.py', 'post', '/{asset_id}/schedules'),
    ('asset_service.py', 'put', '/{asset_id}/schedules/{sid}'),
    ('asset_service.py', 'post', '/{asset_id}/meter/reset'),
    ('asset_service.py', 'delete', '/{asset_id}/schedules/{sid}'),
    ('asset_service.py', 'post', '/{asset_id}/records'),
    ('asset_service.py', 'delete', '/{asset_id}/records/{rid}'),
    ('asset_service.py', 'put', '/{asset_id}/records/{rid}'),
    ('asset_service.py', 'post', '/{asset_id}/meter'),
    ('asset_service.py', 'post', '/service/scan-reminders'),
    ('auth.py', 'post', '/logout'),
    ('auth.py', 'post', '/download-token'),
    ('auth.py', 'post', '/change-password'),
    ('auth.py', 'post', '/update-profile'),
    ('auth.py', 'post', '/refresh'),
    ('auth_invite.py', 'post', '/users/{user_id}/invite'),
    ('auth_invite.py', 'post', '/auth/invite/redeem'),
    ('auth_invite.py', 'post', '/users/{user_id}/reset-password'),
    ('auth_invite.py', 'post', '/auth/forgot-password'),
    ('auth_invite.py', 'post', '/users/{user_id}/pin'),
    ('auth_invite.py', 'post', '/users/{user_id}/unlock'),
    ('bulk_import_prestarts.py', 'post', '/init'),
    ('bulk_import_prestarts.py', 'post', '/{job_id}/start'),
    ('bulk_import_prestarts.py', 'post', '/{job_id}/approve'),
    ('email_outbox.py', 'post', '/send'),
    ('email_outbox.py', 'post', '/outbox/{email_id}/retry'),
    ('exports.py', 'delete', '/{eid}'),
    ('exports.py', 'post', '/{eid}/render-pdf'),
    ('file_pdf.py', 'post', '/files/{file_id}/preview-token'),
    ('file_pdf.py', 'post', '/files/inline-pdf'),
    ('file_pdf.py', 'post', '/files/pdf-bundle'),
    ('file_pdf.py', 'post', '/admin/install-libreoffice'),
    ('forms.py', 'post', '/fleet/vehicle-overrides'),
    ('forms.py', 'post', '/templates'),
    ('forms.py', 'patch', '/templates/{template_id}'),
    ('forms.py', 'delete', '/templates/{template_id}'),
    ('forms.py', 'post', '/templates/import'),
    ('forms.py', 'post', '/templates/ai-generate'),
    ('forms.py', 'post', '/templates/{template_id}/submissions'),
    ('forms.py', 'delete', '/submissions/{submission_id}'),
    ('forms.py', 'post', '/submissions/{submission_id}/photos'),
    ('forms.py', 'post', '/submissions/pdf-token'),
    ('health_extras.py', 'patch', '/me/suspicious-alerts'),
    ('help_reference_images.py', 'post', '/upload'),
    ('help_reference_images.py', 'delete', '/{slot}'),
    ('hr_employees.py', 'post', '/{uid}/reveal-dob'),
    ('hr_employees.py', 'post', '/{uid}/reveal-address'),
    ('hr_employees.py', 'patch', '/{uid}'),
    ('hr_employees.py', 'delete', '/{uid}'),
    ('hr_employees.py', 'post', '/reimport'),
    ('imports.py', 'post', '/pdf'),
    ('induction_columns.py', 'post', '/merge'),
    ('induction_columns.py', 'post', '/move-to-certifications'),
    ('induction_columns.py', 'post', '/clear-column-key'),
    ('integrations.py', 'put', '/{kind}'),
    ('integrations.py', 'post', '/navixy/get-hash'),
    ('integrations.py', 'post', '/navixy/test-connection'),
    ('integrations.py', 'post', '/admin/migrate-integration-secrets'),
    ('mobile_modules.py', 'put', '/settings/mobile-modules'),
    ('org_settings.py', 'put', '/companies'),
    ('org_settings.py', 'put', '/role-presets/{role}/forms'),
    ('pdf_routes.py', 'post', '/pdf-token'),
    ('renewals.py', 'post', '/doc-types'),
    ('renewals.py', 'patch', '/doc-types/{type_id}'),
    ('renewals.py', 'delete', '/doc-types/{type_id}'),
    ('renewals.py', 'post', '/bulk'),
    ('renewals.py', 'patch', '/{rid}'),
    ('renewals.py', 'post', '/{rid}/revoke'),
    ('renewals.py', 'delete', '/{rid}'),
    ('renewals.py', 'post', '/bulk-delete'),
    ('settings_nav.py', 'put', '/nav-layout'),
    ('simpro_import_users.py', 'post', '/import-employees'),
    ('simpro_zip_import.py', 'post', '/{worker_id}/simpro-zip-import'),
    ('simpro_zip_import.py', 'post', '/identify-zip'),
    ('simpro_zip_import.py', 'post', '/bulk-zip-import'),
    ('simpro_zip_import.py', 'post', '/inductions/backfill-matrix-links'),
    ('simpro_zip_import.py', 'post', '/accept-suggestions'),
    ('simpro_zip_import.py', 'post', '/{worker_id}/unmatched-documents/{doc_id}/reclassify'),
    ('simpro_zip_import.py', 'post', '/{worker_id}/unmatched-documents/{doc_id}/move-to-hr'),
    ('simpro_zip_import.py', 'delete', '/{worker_id}/unmatched-documents/{doc_id}'),
    ('sites_signon_v127.py', 'post', '/{site_id}/signon-v127'),
    ('supplier_panels.py', 'post', '/{supplier_id}/tasks'),
    ('supplier_panels.py', 'patch', '/tasks/{task_id}'),
    ('supplier_panels.py', 'delete', '/tasks/{task_id}'),
    ('supplier_panels.py', 'post', '/{supplier_id}/notes'),
    ('supplier_panels.py', 'patch', '/notes/{note_id}'),
    ('supplier_panels.py', 'delete', '/notes/{note_id}'),
    ('supplier_panels.py', 'post', '/{supplier_id}/members'),
    ('supplier_panels.py', 'patch', '/members/{member_id}'),
    ('supplier_panels.py', 'delete', '/members/{member_id}'),
    ('swms_extras.py', 'post', '/import-docx'),
    ('swms_extras.py', 'put', '/assignments/bulk'),
    ('swms_extras.py', 'put', '/assignments/{swms_id}'),
    ('swms_phase45.py', 'post', '/from-paste'),
    ('swms_phase45.py', 'post', '/bulk-delete'),
    ('swms_phase45.py', 'post', '/{swms_id}/restore'),
    ('swms_phase45.py', 'post', '/from-scan'),
    ('user_prefs.py', 'put', '/{resource}'),
    ('worker_certifications.py', 'post', '/{worker_id}/certifications'),
    ('worker_certifications.py', 'post', '/{worker_id}/certifications/upload'),
    ('worker_certifications.py', 'post', '/certifications/{cert_id}/send-reminder'),
    ('worker_certifications.py', 'post', '/certifications/scan-reminders'),
    ('workers.py', 'post', '/sync-from-simpro'),
    ('workers.py', 'post', '/{worker_id}/photo'),
    ('workers.py', 'delete', '/{worker_id}/photo'),
    ('workers_inductions.py', 'post', '/import-xlsx'),
    ('workers_inductions.py', 'post', '/import-xlsx/commit'),
    ('workers_inductions.py', 'put', '/cell'),
    ('workers_inductions.py', 'post', '/print'),
    ('workers_qr.py', 'post', '/{worker_id}/nfc-pair'),
    ('workers_qr.py', 'delete', '/{worker_id}/nfc-pair'),
    ('workspaces.py', 'patch', '/{wid}'),
    ('workspaces.py', 'delete', '/{wid}'),
    ('workspaces.py', 'post', '/{wid}/unassign-all'),
})

def test_permissions_gate_contract_v44():
    routes = _scan()
    assert routes, "route scanner found ZERO routes — glob is broken"

    offenders: list[tuple[str, str, str, list[str]]] = []
    for name, verb, path, gates in routes:
        if (name, verb, path) in _AUTH_BOOTSTRAP_ALLOWLIST:
            continue
        if (name, verb, path) in _KNOWN_UNGATED_LEGACY:
            continue
        # Contract: at least ONE Depends() name in the endpoint's chunk
        # must be a permission-wrapper.
        if not any(_is_permission_gate(g) for g in gates):
            offenders.append((name, verb, path, gates))

    assert not offenders, (
        "PERMISSIONS-GATE CONTRACT VIOLATION — the following state-"
        "mutating routes have NO permission gate (require_permission / "
        "require_admin / recognised alias). Either add a gate or, if "
        "the route is legitimately unauthenticated auth bootstrap, add "
        "it to `_AUTH_BOOTSTRAP_ALLOWLIST` with a comment.\n\n"
        + "\n".join(
            f"  • {n}: {v.upper()} {p}  (gates seen: {gs or 'none'})"
            for n, v, p, gs in offenders
        )
    )


def test_ai_routes_are_gated_v44():
    """Explicit assertion for the P0-AI recommendation from the audit.
    The 3 AI routes must have `require_ai_use` (an alias for
    `require_permission("ai", "use")`) in their Depends chain."""
    ai_src = (_BACKEND / "ai.py").read_text(encoding="utf-8")
    for path in ("/swms-draft", "/diary-structure", "/hazard-vision"):
        m = _ROUTE_RE.search(ai_src)
        assert m, "route regex must match at least once in ai.py"
        # find the block for the specific path
        idx = ai_src.find(f'"{path}"')
        assert idx > 0, f"path {path!r} not found in ai.py"
        chunk = ai_src[idx: idx + 500]
        gates = _endpoint_gates(chunk)
        assert any(_is_permission_gate(g) for g in gates), (
            f"ai.py {path} has no permission-wrapper gate. Gates seen: {gates}"
        )
