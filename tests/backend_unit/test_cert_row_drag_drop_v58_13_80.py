"""v58.13.80 — Per-row drag-and-drop attach on Worker Certifications.
"""
from __future__ import annotations
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

WORKERS_JSX = (FRONTEND / "src" / "pages" / "Workers.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Row-level drop targets + accept whitelist
# ─────────────────────────────────────────────────────────────
def test_row_drag_state_declared():
    assert "const [rowDragOverId, setRowDragOverId]" in WORKERS_JSX, (
        "Workers.jsx must declare `rowDragOverId` state to track which "
        "cert row is being hovered with a dragged file."
    )
    assert "const [rowFlashId, setRowFlashId]" in WORKERS_JSX, (
        "Workers.jsx must declare `rowFlashId` state to drive the "
        "just-attached pulse animation."
    )


def test_attach_to_row_helper_exists_and_uses_v79_endpoint():
    assert "const attachToRow = async (cert, fileList) =>" in WORKERS_JSX, (
        "attachToRow(cert, fileList) helper must exist so both the "
        "onDrop handler and any future paperclip-drop consumer share "
        "one code path."
    )
    idx = WORKERS_JSX.index("const attachToRow = async (cert, fileList)")
    body = WORKERS_JSX[idx:idx + 1600]
    assert "/workers/${workerId}/certifications/${cert.id}/upload" in body, (
        "attachToRow must POST to the v58.13.79 attach endpoint."
    )


def test_attach_to_row_rejects_multi_file_drops():
    idx = WORKERS_JSX.index("const attachToRow = async (cert, fileList)")
    body = WORKERS_JSX[idx:idx + 1600]
    assert "fileList.length > 1" in body, (
        "attachToRow must reject drops carrying more than one file."
    )
    assert "Only one file per certification row" in body, (
        "Multi-file rejection must show a clear user-visible toast."
    )


def test_attach_to_row_rejects_non_image_pdf_types():
    idx = WORKERS_JSX.index("const attachToRow = async (cert, fileList)")
    body = WORKERS_JSX[idx:idx + 1600]
    assert "_isAcceptedForRow(file)" in body, (
        "attachToRow must call _isAcceptedForRow(file) to gate on "
        "PDF/JPG/PNG before invoking the endpoint."
    )
    assert "Only PDF, JPG or PNG files" in body, (
        "Type-mismatch rejection must show a clear user-visible toast."
    )


def test_accept_helper_covers_correct_types():
    assert "'application/pdf'" in WORKERS_JSX
    assert "'image/png'" in WORKERS_JSX
    assert "'image/jpeg'" in WORKERS_JSX
    # Extension fallback for browsers/OSes that don't set MIME.
    assert "/\\.(pdf|jpe?g|png)$/i" in WORKERS_JSX, (
        "Row accept whitelist must have a `.pdf|.jpg|.jpeg|.png` "
        "extension fallback for files with a blank MIME type."
    )


def test_row_has_drag_and_drop_handlers():
    # The <tr> block for a cert row must carry onDragOver, onDragLeave,
    # onDrop when `canEdit`.
    idx = WORKERS_JSX.index("data-testid={`cert-row-${c.id}`}")
    body = WORKERS_JSX[max(0, idx - 1600):idx + 200]
    for evt in ("onDragOver={canEdit", "onDragLeave={canEdit", "onDrop={canEdit"):
        assert evt in body, (
            f"Cert row must carry `{evt} ? ... : undefined` so drag-"
            f"and-drop is gated on write permission."
        )
    # dropEffect = 'copy' gives the OS the correct cursor icon.
    assert "dropEffect = 'copy'" in body, (
        "Cert row onDragOver must set `dataTransfer.dropEffect = 'copy'` "
        "so the cursor shows the copy affordance."
    )
    # Drop calls attachToRow with dataTransfer.files.
    assert "attachToRow(c, e.dataTransfer?.files)" in body, (
        "Cert row onDrop must call `attachToRow(c, e.dataTransfer?.files)`."
    )


def test_row_highlight_classes_present():
    # Row applies the highlight classes conditionally based on
    # rowDragOverId + rowFlashId.
    assert "'bg-blue-50 outline outline-2 outline-blue-300 cursor-copy'" in WORKERS_JSX, (
        "Row must apply the drag-hover highlight "
        "`bg-blue-50 outline outline-2 outline-blue-300 cursor-copy`."
    )
    assert "'bg-blue-100'" in WORKERS_JSX, (
        "Row must apply the just-attached flash "
        "`bg-blue-100` (transient after successful attach)."
    )


def test_replace_vs_new_toast_wording():
    idx = WORKERS_JSX.index("const attachToRow = async (cert, fileList)")
    body = WORKERS_JSX[idx:idx + 1600]
    assert 'Replaced file on "${cert.name}"' in body, (
        "When the cert already had a file the toast must read "
        '`Replaced file on "{cert.name}"` (distinct from the fresh '
        "attach copy)."
    )
    assert 'Attached to "${cert.name}"' in body, (
        "When attaching a first file the toast must read "
        '`Attached to "{cert.name}"`.'
    )


# ─────────────────────────────────────────────────────────────
# Top drop-zone rework (Option A — keep, rename)
# ─────────────────────────────────────────────────────────────
def test_top_dropzone_rebranded_to_new_row_semantics():
    """Option A per spec — the top drop-zone still creates a NEW cert
    row, but its copy is rewritten so users understand it's for
    certifications not already in the list."""
    assert "Drop a new certification here (creates a new row)" in WORKERS_JSX, (
        "Top drop-zone label must be rewritten to "
        "`Drop a new certification here (creates a new row)`."
    )
    assert "drag onto a row" in WORKERS_JSX, (
        "Top drop-zone sub-label must tell users to `drag onto a row` "
        "for the attach-to-existing flow."
    )
    # Old copy is gone.
    assert "auto-files to Document Library" not in WORKERS_JSX, (
        "Old top drop-zone sub-label `auto-files to Document Library "
        "\"Licences & Tickets\"` must be gone."
    )


# ─────────────────────────────────────────────────────────────
# Accessibility — paperclip button preserved
# ─────────────────────────────────────────────────────────────
def test_paperclip_button_still_present():
    assert 'data-testid={`cert-attach-btn-${c.id}`}' in WORKERS_JSX, (
        "v58.13.79 Paperclip attach button must be preserved — "
        "drag-and-drop supplements, doesn't replace, click-to-upload."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 80 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_80():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 80


def test_cache_version_bumped_to_at_least_80():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 80


def test_mobile_bundle_version_bumped_to_at_least_80():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 80
