"""v58.13.25 — Employee ↔ Worker linker FE smoke."""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
PAGE = APP / "frontend/src/pages/settings/HrEmployeesPage.jsx"
MODAL = APP / "frontend/src/components/WorkerLinkModal.jsx"


def test_page_imports_modal_and_renders_link_column():
    src = PAGE.read_text(encoding="utf-8")
    assert "import WorkerLinkModal from '../../components/WorkerLinkModal'" in src
    # Column header.
    assert ">Linked worker<" in src or re.search(r">\s*Linked worker\s*<", src)
    # Both cell testids present (uses ${row.employee_id} template).
    assert "hr-row-linked-worker-${row.employee_id}" in src
    assert "hr-row-link-${row.employee_id}" in src
    assert "hr-row-unlink-${row.employee_id}" in src
    # Modal is mounted with the required props.
    assert "<WorkerLinkModal" in src
    assert "onLinked={() => load()}" in src


def test_row_action_handlers_stop_propagation():
    """v58.13.10 flash-bug guardrail: both link-open and unlink
    handlers must stopPropagation + preventDefault so the row-click
    drawer-open doesn't fire."""
    src = PAGE.read_text(encoding="utf-8")
    # Unlink handler body.
    m_un = re.search(
        r"data-testid=\{`hr-row-unlink-\$\{row\.employee_id\}`\}",
        src,
    )
    assert m_un, "unlink testid not found"
    # Search backwards to find the onClick handler for unlink.
    tail = src[max(0, m_un.start() - 800): m_un.start()]
    assert "e.stopPropagation()" in tail
    assert "e.preventDefault()" in tail
    # Link handler.
    m_l = re.search(
        r"data-testid=\{`hr-row-link-\$\{row\.employee_id\}`\}",
        src,
    )
    assert m_l, "link testid not found"
    tail = src[max(0, m_l.start() - 500): m_l.start()]
    assert "e.stopPropagation()" in tail
    assert "e.preventDefault()" in tail


def test_modal_exports_and_similarity_threshold():
    src = MODAL.read_text(encoding="utf-8")
    assert "export default function WorkerLinkModal(" in src
    # Fetches both endpoints.
    assert "/hr/employees/${employee.id}/link-candidates" in src
    assert "/hr/employees/${employee.id}/link-worker" in src
    # Similarity threshold logic (perfect vs fuzzy).
    assert "c.similarity >= 1.0" in src
    # Chip colours per approved Pass 1 plan.
    assert "bg-emerald-100" in src and "text-emerald-800" in src
    assert "bg-amber-100" in src and "text-amber-800" in src
    # 409 collision UX.
    assert "worker-already-linked" in src


def test_modal_action_handlers_stop_propagation():
    src = MODAL.read_text(encoding="utf-8")
    # `link` callback body.
    m = re.search(
        r"const link\s*=\s*useCallback\(\s*async\s*\(e,\s*workerId\)\s*=>\s*\{([\s\S]*?)\},\s*\[",
        src,
    )
    assert m, "link handler not resolvable"
    body = m.group(1)
    assert "e?.stopPropagation?.()" in body
    assert "e?.preventDefault?.()" in body


def test_backdrop_close_pattern_present():
    src = MODAL.read_text(encoding="utf-8")
    assert "e.target === e.currentTarget" in src
    # Body-scroll lock hook.
    assert "useLockBodyScroll" in src


def test_version_sync_current():
    import re
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
