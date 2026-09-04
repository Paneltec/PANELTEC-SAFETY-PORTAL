"""v58.13.79 — Attach a file to an EXISTING certification (fixes the
"image disappeared and not connected to any particular type" bug).
"""
from __future__ import annotations
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
BACKEND = APP / "backend"
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

CERTS_PY = (BACKEND / "worker_certifications.py").read_text(encoding="utf-8")
WORKERS_JSX = (FRONTEND / "src" / "pages" / "Workers.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Backend — new attach-to-existing endpoint
# ─────────────────────────────────────────────────────────────
def test_attach_endpoint_registered():
    assert (
        '@router.post("/{worker_id}/certifications/{cert_id}/upload"'
        in CERTS_PY
    ), (
        "New v58.13.79 attach-to-existing endpoint must be registered "
        "at POST /workers/{worker_id}/certifications/{cert_id}/upload."
    )
    assert "async def attach_cert_file(" in CERTS_PY, (
        "Handler function `attach_cert_file` must exist."
    )


def test_attach_uses_cert_name_for_folder_classification():
    """The folder must be chosen from the EXISTING cert's `name`
    (e.g. 'First Aid' → 'First Aid' folder), NOT from the uploaded
    filename which could be a raw phone stem like `134098955674089059`.
    That's the whole point of the ship."""
    idx = CERTS_PY.index("async def attach_cert_file(")
    body = CERTS_PY[idx:idx + 3500]
    assert 'seed_name = _match_folder_name(existing.get("name")' in body, (
        "attach_cert_file must call _match_folder_name(existing['name']) "
        "so the file lands in the correct cert-type folder, not one "
        "derived from the raw phone filename."
    )


def test_attach_never_creates_a_new_cert_row():
    """The bug this ship fixes was `upload_cert_file` always creating a
    NEW cert row from the filename. `attach_cert_file` must PATCH the
    existing row — no `db.worker_certifications.insert_one(...)` in its
    body."""
    idx = CERTS_PY.index("async def attach_cert_file(")
    end = CERTS_PY.index("async def ", idx + 10) if "async def " in CERTS_PY[idx + 10:] else len(CERTS_PY)
    body = CERTS_PY[idx:end]
    assert "insert_one" not in body or "doc_files.insert_one" in body, (
        "attach_cert_file may only `insert_one` into `doc_files` — "
        "it MUST NOT insert into worker_certifications."
    )
    assert "worker_certifications.insert_one" not in body, (
        "attach_cert_file MUST NOT create a new worker_certifications "
        "row — that reintroduces the original bug."
    )
    # Positive: it MUST update the existing row.
    assert "worker_certifications.find_one_and_update" in body, (
        "attach_cert_file must PATCH the existing cert via "
        "find_one_and_update(doc_file_id=..., doc_folder_id=..., ...)."
    )


def test_attach_soft_deletes_replaced_file():
    """Attaching a second time must soft-delete the previous file so
    we don't leak orphan doc_files."""
    idx = CERTS_PY.index("async def attach_cert_file(")
    body = CERTS_PY[idx:idx + 3500]
    assert "old_file_id = existing.get(\"doc_file_id\")" in body, (
        "attach_cert_file must capture the current doc_file_id before "
        "replacing it."
    )
    assert 'db.doc_files.update_one(' in body and '"deleted_at": now_iso()' in body, (
        "attach_cert_file must soft-delete the previous doc_files row "
        "when replacing it — no orphan storage leaks."
    )


def test_attach_returns_404_when_cert_missing():
    idx = CERTS_PY.index("async def attach_cert_file(")
    body = CERTS_PY[idx:idx + 3500]
    assert 'raise HTTPException(404, "Certification not found")' in body, (
        "attach_cert_file must return 404 with a clean message when "
        "the target cert doesn't exist."
    )


# ─────────────────────────────────────────────────────────────
# Frontend — Paperclip button on empty-file rows
# ─────────────────────────────────────────────────────────────
def test_workers_jsx_imports_paperclip():
    assert "Paperclip" in WORKERS_JSX, (
        "Workers.jsx must import Paperclip from lucide-react for the "
        "cert-attach button glyph."
    )
    import_line = next(
        (ln for ln in WORKERS_JSX.splitlines() if "'lucide-react'" in ln),
        None,
    )
    assert import_line is not None and "Paperclip" in import_line, (
        "Paperclip must be in the top-of-file lucide-react import."
    )


def test_workers_jsx_renders_attach_button_on_empty_rows():
    # The button gets a stable testid `cert-attach-btn-{id}` and lives
    # inside the `{c.doc_file_id ? … : canEdit ? <> Paperclip … </> : —}`
    # branch. Pin the presence + wiring.
    assert 'data-testid={`cert-attach-btn-${c.id}`}' in WORKERS_JSX, (
        "Empty-file cert rows must render a Paperclip attach button "
        "with data-testid `cert-attach-btn-{id}`."
    )
    assert 'data-testid={`cert-attach-input-${c.id}`}' in WORKERS_JSX, (
        "Attach flow needs a hidden `<input type=file>` per row "
        "carrying data-testid `cert-attach-input-{id}`."
    )


def test_attach_input_posts_to_correct_endpoint():
    # Extract the block around the attach button.
    idx = WORKERS_JSX.index("cert-attach-btn-${c.id}")
    body = WORKERS_JSX[max(0, idx - 200):idx + 2000]
    assert "/workers/${workerId}/certifications/${c.id}/upload" in body, (
        "Attach input onChange must POST to "
        "`/workers/${workerId}/certifications/${c.id}/upload` (v58.13.79)."
    )
    # And it must set uploading state + reload the list after success.
    assert "setUploading(true)" in body and "await load()" in body, (
        "Attach flow must set uploading state and reload the list "
        "after success."
    )
    # Toast confirms attachment to the cert BY NAME so the user knows
    # what happened.
    assert 'Attached to "${c.name}"' in body, (
        "Attach flow must toast `Attached to \"{cert.name}\"` on success "
        "so the user has visible confirmation the file linked to the "
        "correct cert type — the whole point of the ship."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 79 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)[a-z]*['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_79():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 79


def test_cache_version_bumped_to_at_least_79():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 79


def test_mobile_bundle_version_bumped_to_at_least_79():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 79
